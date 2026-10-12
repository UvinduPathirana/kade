package lk.kade.ledger;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import lk.kade.ledger.outbox.UuidV7;
import lk.kade.template.v1.CreateNoteRequest;
import lk.kade.template.v1.NoteCreated;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;

/** The NoteCreated consumer against real Kafka: decode by header, dedupe, retry, dead-letter. */
class NoteEventsConsumerIT extends IntegrationTestBase {

    private static final String TOPIC = "kade.note.events";
    private static final Duration WAIT = Duration.ofSeconds(30);

    @Value("${spring.kafka.bootstrap-servers}")
    String brokers;

    private KafkaProducer<byte[], byte[]> producer;

    @BeforeEach
    void producer() {
        producer = new KafkaProducer<>(Map.of(
                ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, brokers,
                ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class,
                ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class));
    }

    @AfterEach
    void closeProducer() {
        producer.close(Duration.ofSeconds(5));
    }

    /** Publishes a record shaped exactly like Debezium's outbox router output. */
    private void publish(UUID eventId, String eventType, byte[] payload) throws Exception {
        ProducerRecord<byte[], byte[]> r = new ProducerRecord<>(TOPIC, eventId.toString().getBytes(StandardCharsets.UTF_8), payload);
        r.headers().add("id", eventId.toString().getBytes(StandardCharsets.UTF_8));
        r.headers().add("eventType", eventType.getBytes(StandardCharsets.UTF_8));
        r.headers().add("traceparent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01".getBytes(StandardCharsets.UTF_8));
        producer.send(r).get();
    }

    private byte[] noteCreated(String currency, long minor) {
        return NoteCreated.newBuilder().setNoteId(UuidV7.next().toString()).setText("t")
                .setAmount(money(minor, currency)).build().toByteArray();
    }

    @Test
    void appliesEachEventExactlyOnceEvenWhenRedelivered() throws Exception {
        String currency = uniqueCurrency();
        UUID first = UuidV7.next();
        UUID second = UuidV7.next();
        publish(first, "kade.template.v1.NoteCreated", noteCreated(currency, 1_000));
        publish(first, "kade.template.v1.NoteCreated", noteCreated(currency, 1_000)); // duplicate delivery
        publish(second, "kade.template.v1.NoteCreated", noteCreated(currency, 250));
        publish(UuidV7.next(), "kade.template.v1.SomethingElse", new byte[] {1, 2, 3}); // ignored type

        long[] totals = await(() -> totals(currency).filter(t -> t[1] == 2));
        assertThat(totals[0]).isEqualTo(1_250);
        assertThat(processed(first)).isTrue();
        Thread.sleep(1_000); // give a wrongly applied duplicate time to show up
        assertThat(totals(currency).orElseThrow()[1]).isEqualTo(2);
    }

    @Test
    void optimisticLockingKeepsConcurrentUpdatesCorrect() throws Exception {
        String currency = uniqueCurrency();
        for (int i = 0; i < 20; i++) {
            publish(UuidV7.next(), "kade.template.v1.NoteCreated", noteCreated(currency, 10));
        }
        long[] totals = await(() -> totals(currency).filter(t -> t[1] == 20));
        assertThat(totals[0]).isEqualTo(200);
        assertThat(totals[2]).as("version bumped once per update").isEqualTo(20);
    }

    @Test
    void malformedEventGoesStraightToTheDlq() throws Exception {
        UUID id = UuidV7.next();
        publish(id, "kade.template.v1.NoteCreated", new byte[] {(byte) 0xff, 0x01});
        ConsumerRecord<byte[], byte[]> dead = awaitDlq(id);
        assertThat(header(dead, "error")).contains("MalformedEventException");
        assertThat(header(dead, "attempts")).isEqualTo("1");
        assertThat(header(dead, "original-topic")).isEqualTo(TOPIC);
        assertThat(header(dead, "original-partition")).matches("[0-5]");
        assertThat(header(dead, "original-offset")).matches("\\d+");
        assertThat(header(dead, "kafka_dlt-exception-stacktrace")).isNull();
        assertThat(processed(id)).isFalse();
    }

    @Test
    void failingEventIsRetriedThenDeadLettered() throws Exception {
        UUID id = UuidV7.next();
        long start = System.nanoTime();
        publish(id, "kade.template.v1.NoteCreated", noteCreated(uniqueCurrency(), -5)); // violates the invariant
        ConsumerRecord<byte[], byte[]> dead = awaitDlq(id);
        assertThat(Duration.ofNanos(System.nanoTime() - start)).as("4 backoffs: 200+400+800+1600 ms")
                .isGreaterThan(Duration.ofMillis(2_500));
        assertThat(header(dead, "error")).contains("total would go negative");
        assertThat(header(dead, "eventType")).isEqualTo("kade.template.v1.NoteCreated");
        assertThat(header(dead, "attempts")).isEqualTo("5");
        assertThat(processed(id)).as("processed_events rolled back with the failed side effect").isFalse();
    }

    @Test
    void eventWithoutAmountIsProcessedAndInvalidMoneySkipsRetries() throws Exception {
        UUID noAmount = UuidV7.next();
        publish(noAmount, "kade.template.v1.NoteCreated", NoteCreated.newBuilder().setNoteId("n").build().toByteArray());
        await(() -> processed(noAmount) ? Optional.of(true) : Optional.empty());

        UUID noCurrency = UuidV7.next();
        long start = System.nanoTime();
        publish(noCurrency, "kade.template.v1.NoteCreated", NoteCreated.newBuilder().setNoteId("n")
                .setAmount(lk.kade.common.v1.Money.newBuilder().setAmountMinor(1)).build().toByteArray());
        ConsumerRecord<byte[], byte[]> dead = awaitDlq(noCurrency);
        assertThat(header(dead, "error")).contains("MalformedEventException", "currency is required");
        assertThat(Duration.ofNanos(System.nanoTime() - start)).as("no backoff").isLessThan(Duration.ofMillis(2_500));
    }

    /** Full path: gRPC -> outbox -> Debezium -> Kafka -> this consumer. Needs the outbox-ledger connector. */
    @Test
    void endToEndThroughDebezium() throws Exception {
        String connect = Optional.ofNullable(System.getenv("CONNECT_URL")).orElse("http://localhost:8083");
        Assumptions.assumeTrue(connectorRunning(connect), "Debezium connector outbox-ledger not registered");
        String currency = uniqueCurrency();
        stub("user-e2e").createNote(CreateNoteRequest.newBuilder()
                .setText("e2e").setAmount(money(4_200, currency)).build());
        long[] totals = await(() -> totals(currency).filter(t -> t[1] == 1));
        assertThat(totals[0]).isEqualTo(4_200);
    }

    // --- helpers -----------------------------------------------------------------------------------------------

    private Optional<long[]> totals(String currency) {
        return jdbc.sql("SELECT total_minor, note_count, version FROM note_totals WHERE currency = :c")
                .param("c", currency).query((rs, n) -> new long[] {rs.getLong(1), rs.getLong(2), rs.getLong(3)}).optional();
    }

    private boolean processed(UUID id) {
        return jdbc.sql("SELECT count(*) FROM processed_events WHERE event_id = :id").param("id", id)
                .query(Long.class).single() == 1;
    }

    private static <T> T await(Supplier<Optional<T>> probe) throws InterruptedException {
        long deadline = System.nanoTime() + WAIT.toNanos();
        while (System.nanoTime() < deadline) {
            Optional<T> v = probe.get();
            if (v.isPresent()) return v.get();
            Thread.sleep(200);
        }
        throw new AssertionError("condition not met within " + WAIT);
    }

    private ConsumerRecord<byte[], byte[]> awaitDlq(UUID id) {
        try (KafkaConsumer<byte[], byte[]> c = new KafkaConsumer<>(Map.of(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, brokers,
                ConsumerConfig.GROUP_ID_CONFIG, "ledger-it-dlq-" + id,
                ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class,
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class))) {
            c.subscribe(List.of(TOPIC + ".dlq"));
            long deadline = System.nanoTime() + WAIT.toNanos();
            while (System.nanoTime() < deadline) {
                for (ConsumerRecord<byte[], byte[]> r : c.poll(Duration.ofMillis(500))) {
                    // The DLQ is shared by every consumer group of the topic (the TS/Go templates and a running
                    // ledger container dead-letter the same test records): pick ours.
                    if (id.toString().equals(header(r, "id"))
                            && "ledger-it".equals(header(r, "failed-by"))) return r;
                }
            }
        }
        throw new AssertionError("no DLQ record for " + id);
    }

    private static String header(ConsumerRecord<?, ?> r, String name) {
        var h = r.headers().lastHeader(name);
        return h == null ? null : new String(h.value(), StandardCharsets.UTF_8);
    }

    private static boolean connectorRunning(String connectUrl) {
        try {
            HttpResponse<String> res = HttpClient.newHttpClient().send(
                    HttpRequest.newBuilder(URI.create(connectUrl + "/connectors/outbox-ledger/status"))
                            .timeout(Duration.ofSeconds(3)).build(),
                    HttpResponse.BodyHandlers.ofString());
            return res.statusCode() == 200 && res.body().contains("\"RUNNING\"");
        } catch (Exception e) {
            return false;
        }
    }

}
