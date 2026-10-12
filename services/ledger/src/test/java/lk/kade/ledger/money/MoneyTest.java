package lk.kade.ledger.money;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.lang.reflect.RecordComponent;
import java.math.RoundingMode;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class MoneyTest {

    @Test
    void roundTripsThroughProto() {
        Money m = Money.lkr(115_000);
        assertThat(Money.fromProto(m.toProto())).isEqualTo(m);
        assertThat(m.toProto().getAmountMinor()).isEqualTo(115_000L);
        assertThat(m.toProto().getCurrency()).isEqualTo("LKR");
    }

    @Test
    void protoWithoutCurrencyIsRejected() {
        assertThatThrownBy(() -> Money.fromProto(lk.kade.common.v1.Money.newBuilder().setAmountMinor(1).build()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsBadCurrencyCodes() {
        assertThatThrownBy(() -> Money.of(1, "lkr")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Money.of(1, "RUPEES")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void arithmeticIsExactAndCurrencySafe() {
        assertThat(Money.lkr(100).plus(Money.lkr(250))).isEqualTo(Money.lkr(350));
        assertThat(Money.lkr(100).minus(Money.lkr(250))).isEqualTo(Money.lkr(-150));
        assertThat(Money.lkr(1_150_00).times(3)).isEqualTo(Money.lkr(3_450_00));
        assertThatThrownBy(() -> Money.lkr(1).plus(Money.of(1, "USD")))
                .isInstanceOf(Money.CurrencyMismatchException.class);
        assertThatThrownBy(() -> Money.lkr(Long.MAX_VALUE).plus(Money.lkr(1))).isInstanceOf(ArithmeticException.class);
        assertThatThrownBy(() -> Money.lkr(Long.MAX_VALUE).times(2)).isInstanceOf(ArithmeticException.class);
    }

    @Test
    void basisPointsRoundOnceWithTheGivenMode() {
        // 12.5% of Rs 10.05 = 125.625 cents
        assertThat(Money.lkr(1005).multiplyBasisPoints(1250, RoundingMode.HALF_EVEN)).isEqualTo(Money.lkr(126));
        assertThat(Money.lkr(1005).multiplyBasisPoints(1250, RoundingMode.DOWN)).isEqualTo(Money.lkr(125));
        // exact half: 0.5 cent rounds to even
        assertThat(Money.lkr(1).multiplyBasisPoints(5000, RoundingMode.HALF_EVEN)).isEqualTo(Money.lkr(0));
        assertThat(Money.lkr(3).multiplyBasisPoints(5000, RoundingMode.HALF_EVEN)).isEqualTo(Money.lkr(2));
    }

    @Test
    void allocateNeverLosesACent() {
        Money[] parts = Money.lkr(10_000).allocate(1, 1, 1);
        assertThat(parts).containsExactly(Money.lkr(3334), Money.lkr(3333), Money.lkr(3333));

        Money[] commission = Money.lkr(-1001).allocate(70, 30);
        assertThat(Arrays.stream(commission).mapToLong(Money::amountMinor).sum()).isEqualTo(-1001);

        Money[] skewed = Money.lkr(5).allocate(0, 1, 1);
        assertThat(skewed[0]).isEqualTo(Money.lkr(0));
        assertThat(skewed[1].amountMinor() + skewed[2].amountMinor()).isEqualTo(5);
    }

    @Test
    void comparesWithinACurrency() {
        assertThat(Money.lkr(2).isGreaterThan(Money.lkr(1))).isTrue();
        assertThat(Money.lkr(-1).isNegative()).isTrue();
        assertThatThrownBy(() -> Money.lkr(1).compareTo(Money.of(1, "USD")))
                .isInstanceOf(Money.CurrencyMismatchException.class);
    }

    @Test
    void holdsNoFloatingPointState() {
        for (RecordComponent c : Money.class.getRecordComponents()) {
            assertThat(c.getType()).isNotIn(double.class, float.class, Double.class, Float.class);
        }
    }
}
