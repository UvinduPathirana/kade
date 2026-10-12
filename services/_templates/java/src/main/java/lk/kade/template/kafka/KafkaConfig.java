package lk.kade.template.kafka;

import com.google.protobuf.InvalidProtocolBufferException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import lk.kade.template.config.KadeProperties;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.Header;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.kafka.core.KafkaAdmin;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.config.ContainerCustomizer;
import org.springframework.kafka.listener.ConcurrentMessageListenerContainer;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.listener.ListenerExecutionFailedException;
import org.springframework.kafka.support.ExponentialBackOffWithMaxRetries;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.kafka.support.KafkaUtils;

/**
 * Failure policy for every listener (Boot wires a {@code CommonErrorHandler} bean into the container factory):
 * retry in place with exponential backoff, and after {@code kade.kafka.attempts} deliveries (CONVENTIONS: 5) publish
 * the original record (value, key, original headers) to {@code <topic>.dlq}, then move on. Malformed records skip
 * the retries.
 *
 * <p>DLQ headers are the same in every language: {@code error}, {@code original-topic}, {@code original-partition},
 * {@code original-offset}, {@code attempts}, {@code failed-by} (consumer group). Spring's own {@code kafka_dlt-*}
 * headers are dropped (they duplicate these and add a multi-KB stack trace).
 *
 * <p>Topics (including {@code .dlq}) are created by the infra stack (deploy/compose/kafka/create-topics.sh);
 * services never create or alter topics, and broker auto-creation is off.
 */
@Configuration(proxyBeanMethods = false)
public class KafkaConfig {

    public static final String DLQ_SUFFIX = ".dlq";

    /** Cross-language DLQ headers (UTF-8 strings). */
    public static final String H_ERROR = "error";
    public static final String H_ORIGINAL_TOPIC = "original-topic";
    public static final String H_ORIGINAL_PARTITION = "original-partition";
    public static final String H_ORIGINAL_OFFSET = "original-offset";
    public static final String H_ATTEMPTS = "attempts";
    public static final String H_FAILED_BY = "failed-by";

    private static final Logger log = LoggerFactory.getLogger(KafkaConfig.class);

    @Bean
    DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<byte[], byte[]> template, KadeProperties props) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(template,
                // partition -1: let the producer pick, the DLQ has a different partition count (1)
                (record, ex) -> new TopicPartition(record.topic() + DLQ_SUFFIX, -1));
        recoverer.excludeHeader(DeadLetterPublishingRecoverer.HeaderNames.HeadersToAdd.values());
        recoverer.setHeadersFunction((record, ex) -> {
            String error = describe(ex);
            String group = Optional.ofNullable(KafkaUtils.getConsumerGroupId()).orElse(props.serviceName());
            Header attemptHeader = record.headers().lastHeader(KafkaHeaders.DELIVERY_ATTEMPT);
            int attempts = attemptHeader == null ? 1 : ByteBuffer.wrap(attemptHeader.value()).getInt();
            log.error("dead-lettering {}-{}@{} after {} attempt(s): {}",
                    record.topic(), record.partition(), record.offset(), attempts, error);
            RecordHeaders headers = new RecordHeaders();
            headers.add(H_ERROR, utf8(error));
            headers.add(H_ORIGINAL_TOPIC, utf8(record.topic()));
            headers.add(H_ORIGINAL_PARTITION, utf8(Integer.toString(record.partition())));
            headers.add(H_ORIGINAL_OFFSET, utf8(Long.toString(record.offset())));
            headers.add(H_ATTEMPTS, utf8(Integer.toString(attempts)));
            headers.add(H_FAILED_BY, utf8(group));
            return headers;
        });

        KadeProperties.Kafka k = props.kafka();
        ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(k.attempts() - 1);
        backOff.setInitialInterval(k.initialBackoff().toMillis());
        backOff.setMultiplier(2.0);
        backOff.setMaxInterval(k.maxBackoff().toMillis());

        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, backOff);
        handler.addNotRetryableExceptions(MalformedEventException.class, InvalidProtocolBufferException.class);
        return handler;
    }

    /** Stamp {@code kafka_deliveryAttempt} on each record so the DLQ can report how many attempts were made. */
    @Bean
    ContainerCustomizer<Object, Object, ConcurrentMessageListenerContainer<Object, Object>> deliveryAttemptHeader() {
        return container -> container.getContainerProperties().setDeliveryAttemptHeader(true);
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    /** "Outermost application exception: message [<- root cause: message]", skipping Spring's listener wrappers. */
    static String describe(Throwable ex) {
        Throwable top = ex;
        while (top instanceof ListenerExecutionFailedException && top.getCause() != null) {
            top = top.getCause();
        }
        Throwable root = NestedExceptionUtils.getMostSpecificCause(top);
        String error = top.getClass().getName() + ": " + top.getMessage();
        return root == top ? error : error + " <- " + root.getClass().getName() + ": " + root.getMessage();
    }

    /** Dedicated admin client for readiness checks (short timeouts, no topic creation). */
    @Bean(destroyMethod = "close")
    AdminClient healthAdminClient(KafkaAdmin kafkaAdmin, KadeProperties props) {
        var config = new java.util.HashMap<>(kafkaAdmin.getConfigurationProperties());
        int timeout = (int) props.kafka().healthTimeout().toMillis();
        config.put(AdminClientConfig.REQUEST_TIMEOUT_MS_CONFIG, timeout);
        config.put(AdminClientConfig.DEFAULT_API_TIMEOUT_MS_CONFIG, timeout);
        config.put(AdminClientConfig.CLIENT_ID_CONFIG, props.serviceName() + "-health");
        return AdminClient.create(config);
    }
}
