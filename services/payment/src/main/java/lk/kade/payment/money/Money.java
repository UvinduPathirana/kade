package lk.kade.payment.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * An amount of money in <b>minor units</b> (cents) and an ISO 4217 currency, mirroring {@code kade.common.v1.Money}.
 *
 * <p>Rules for money code in Kadé:
 * <ul>
 *   <li>{@code long} minor units only. No {@code double}/{@code float} anywhere near money; no {@code BigDecimal}
 *       amounts either (it only appears inside {@link #multiplyBasisPoints} to round once, explicitly).
 *   <li>All arithmetic is overflow-checked ({@link Math#addExact}); mixing currencies throws.
 *   <li>Rates are basis points (1 bp = 0.01%) and every division names its {@link RoundingMode}.
 *   <li>Splitting uses {@link #allocate} so the parts always sum to the whole (no lost cents).
 * </ul>
 */
public record Money(long amountMinor, String currency) implements Comparable<Money> {

    public static final String LKR = "LKR";
    private static final Pattern ISO_4217 = Pattern.compile("[A-Z]{3}");

    public Money {
        Objects.requireNonNull(currency, "currency");
        if (!ISO_4217.matcher(currency).matches()) {
            throw new IllegalArgumentException("currency must be an ISO 4217 code, got '" + currency + "'");
        }
    }

    public static Money of(long amountMinor, String currency) {
        return new Money(amountMinor, currency);
    }

    public static Money lkr(long amountMinor) {
        return new Money(amountMinor, LKR);
    }

    public static Money zero(String currency) {
        return new Money(0, currency);
    }

    // --- protobuf mapping -------------------------------------------------------------------------------------

    /** Strict: currency must be present. Use at API boundaries and when decoding events. */
    public static Money fromProto(lk.kade.common.v1.Money proto) {
        Objects.requireNonNull(proto, "money");
        if (proto.getCurrency().isEmpty()) {
            throw new IllegalArgumentException("money.currency is required");
        }
        return new Money(proto.getAmountMinor(), proto.getCurrency());
    }

    public lk.kade.common.v1.Money toProto() {
        return lk.kade.common.v1.Money.newBuilder().setAmountMinor(amountMinor).setCurrency(currency).build();
    }

    // --- arithmetic --------------------------------------------------------------------------------------------

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(Math.addExact(amountMinor, other.amountMinor), currency);
    }

    public Money minus(Money other) {
        requireSameCurrency(other);
        return new Money(Math.subtractExact(amountMinor, other.amountMinor), currency);
    }

    public Money times(long quantity) {
        return new Money(Math.multiplyExact(amountMinor, quantity), currency);
    }

    public Money negate() {
        return new Money(Math.negateExact(amountMinor), currency);
    }

    /**
     * Applies a rate in basis points (e.g. commission 1250 bp = 12.5%) and rounds once with the given mode.
     * Use {@link RoundingMode#HALF_EVEN} for fees unless a contract says otherwise.
     */
    public Money multiplyBasisPoints(long basisPoints, RoundingMode rounding) {
        BigDecimal exact = BigDecimal.valueOf(amountMinor).multiply(BigDecimal.valueOf(basisPoints));
        long rounded = exact.divide(BigDecimal.valueOf(10_000), 0, rounding).longValueExact();
        return new Money(rounded, currency);
    }

    /**
     * Splits this amount in proportion to {@code ratios}; any remainder cents go to the first parts, so the
     * result always sums exactly to this amount (e.g. Rs 100.00 three ways = 33.34 + 33.33 + 33.33).
     */
    public Money[] allocate(long... ratios) {
        if (ratios.length == 0) {
            throw new IllegalArgumentException("at least one ratio");
        }
        long total = 0;
        for (long r : ratios) {
            if (r < 0) throw new IllegalArgumentException("ratios must be non-negative");
            total = Math.addExact(total, r);
        }
        if (total == 0) {
            throw new IllegalArgumentException("ratios must not all be zero");
        }
        Money[] parts = new Money[ratios.length];
        long remainder = amountMinor;
        for (int i = 0; i < ratios.length; i++) {
            long share = BigDecimal.valueOf(amountMinor).multiply(BigDecimal.valueOf(ratios[i]))
                    .divide(BigDecimal.valueOf(total), 0, RoundingMode.DOWN).longValueExact();
            parts[i] = new Money(share, currency);
            remainder -= share;
        }
        long step = Long.signum(remainder);
        for (int i = 0; remainder != 0; i = (i + 1) % parts.length) {
            if (ratios[i] == 0) continue;
            parts[i] = new Money(parts[i].amountMinor + step, currency);
            remainder -= step;
        }
        return parts;
    }

    // --- comparisons -------------------------------------------------------------------------------------------

    public boolean isZero() { return amountMinor == 0; }

    public boolean isNegative() { return amountMinor < 0; }

    public boolean isPositive() { return amountMinor > 0; }

    public boolean isGreaterThan(Money other) { return compareTo(other) > 0; }

    @Override
    public int compareTo(Money other) {
        requireSameCurrency(other);
        return Long.compare(amountMinor, other.amountMinor);
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new CurrencyMismatchException(currency, other.currency);
        }
    }

    /** For logs only. Gateways format for display ("Rs 1,150"). */
    @Override
    public String toString() {
        return currency + " " + amountMinor + " (minor)";
    }

    public static final class CurrencyMismatchException extends IllegalArgumentException {
        public CurrencyMismatchException(String a, String b) {
            super("currency mismatch: " + a + " vs " + b);
        }
    }
}
