package lk.kade.template.note;

import lk.kade.template.money.Money;

/**
 * A versioned aggregate: the shape of a promotion budget or a ledger balance. Domain rules run in Java on a
 * snapshot; {@link NoteTotalsRepository#update} only succeeds if nobody changed the row since it was read.
 */
public record NoteTotals(Money total, long noteCount, long version) {

    public static NoteTotals empty(String currency) {
        return new NoteTotals(Money.zero(currency), 0, 0);
    }

    /** Adds a note's amount. Example invariant check, as a budget would check its cap. */
    public NoteTotals add(Money amount) {
        Money next = total.plus(amount); // throws on currency mismatch or overflow
        if (next.isNegative()) {
            throw new IllegalStateException("total would go negative");
        }
        return new NoteTotals(next, noteCount + 1, version);
    }
}
