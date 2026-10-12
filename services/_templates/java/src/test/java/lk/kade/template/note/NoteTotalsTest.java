package lk.kade.template.note;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import lk.kade.template.money.Money;
import org.junit.jupiter.api.Test;

class NoteTotalsTest {

    @Test
    void addKeepsVersionForTheConditionalUpdate() {
        NoteTotals t = new NoteTotals(Money.lkr(100), 1, 7).add(Money.lkr(50));
        assertThat(t).isEqualTo(new NoteTotals(Money.lkr(150), 2, 7));
    }

    @Test
    void enforcesInvariants() {
        assertThatThrownBy(() -> NoteTotals.empty("LKR").add(Money.lkr(-1))).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> NoteTotals.empty("LKR").add(Money.of(1, "USD"))).isInstanceOf(IllegalArgumentException.class);
    }
}
