package lk.kade.payment.kafka;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.protobuf.InvalidProtocolBufferException;
import org.junit.jupiter.api.Test;
import org.springframework.kafka.listener.ListenerExecutionFailedException;

class KafkaConfigTest {

    @Test
    void dlqErrorHeaderNamesTheApplicationExceptionAndItsRootCause() {
        var root = new InvalidProtocolBufferException("bad wire type");
        var ex = new ListenerExecutionFailedException("listener failed", new MalformedEventException("cannot decode X", root));
        assertThat(KafkaConfig.describe(ex)).isEqualTo(
                "lk.kade.payment.kafka.MalformedEventException: cannot decode X"
                        + " <- com.google.protobuf.InvalidProtocolBufferException: bad wire type");
        assertThat(KafkaConfig.describe(new IllegalStateException("boom")))
                .isEqualTo("java.lang.IllegalStateException: boom");
    }
}
