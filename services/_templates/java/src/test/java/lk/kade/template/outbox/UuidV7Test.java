package lk.kade.template.outbox;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class UuidV7Test {

    @Test
    void isVersion7VariantRfcAndTimeOrdered() throws InterruptedException {
        UUID a = UuidV7.next();
        Thread.sleep(2);
        UUID b = UuidV7.next();
        assertThat(a.version()).isEqualTo(7);
        assertThat(a.variant()).isEqualTo(2);
        assertThat(a.toString().compareTo(b.toString())).isNegative();
        long millis = a.getMostSignificantBits() >>> 16;
        assertThat(millis).isBetween(System.currentTimeMillis() - 5_000, System.currentTimeMillis());
    }
}
