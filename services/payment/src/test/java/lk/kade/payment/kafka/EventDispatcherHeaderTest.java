package lk.kade.payment.kafka;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;

class EventDispatcherHeaderTest {

    @Test
    void readsPlainAndJsonQuotedHeaders() {
        ConsumerRecord<byte[], byte[]> r = new ConsumerRecord<>("t", 0, 0, null, new byte[0]);
        r.headers().add("eventType", "kade.payment.v1.PaymentAuthorised".getBytes(StandardCharsets.UTF_8));
        r.headers().add("id", "\"0199e5a3-0000-7000-8000-000000000001\"".getBytes(StandardCharsets.UTF_8));
        assertThat(EventDispatcher.header(r, "eventType")).isEqualTo("kade.payment.v1.PaymentAuthorised");
        assertThat(EventDispatcher.header(r, "id")).isEqualTo("0199e5a3-0000-7000-8000-000000000001");
        assertThat(EventDispatcher.header(r, "missing")).isNull();
    }
}
