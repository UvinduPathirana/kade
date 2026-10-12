package lk.kade.promotion.voucher;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import lk.kade.promotion.money.Money;
import lk.kade.promotion.support.Colombo;
import lk.kade.promotion.support.Rs;
import lk.kade.promotion.v1.FundedBy;
import lk.kade.promotion.v1.Voucher;
import lk.kade.promotion.v1.VoucherStatus;
import lk.kade.promotion.v1.VoucherType;

/** One row of {@code vouchers}. Counters move only through {@link VoucherRepository#updateCounters}. */
public record VoucherRow(
        String code,
        String label,
        String description,
        Kind type,
        long amountMinor,
        int percent,
        long maxDiscountMinor,
        long minOrderMinor,
        String currency,
        List<String> restaurantIds,
        boolean newCustomersOnly,
        LocalDate startsOn,
        LocalDate endsOn,
        int uses,
        int heldUses,
        int useLimit,
        int perCustomerLimit,
        long budgetMinor,
        long spentMinor,
        long reservedMinor,
        String status,
        String statusReason,
        String fundedBy,
        Instant createdAt,
        long version) {

    public static final String ACTIVE = "active";
    public static final String SCHEDULED = "scheduled";
    public static final String PAUSED = "paused";
    public static final String ENDED = "ended";

    public enum Kind {
        FIXED("fixed"), PERCENT("percent"), FREE_DELIVERY("free_delivery");

        public final String db;

        Kind(String db) {
            this.db = db;
        }

        public static Kind fromDb(String db) {
            for (Kind k : values()) {
                if (k.db.equals(db)) {
                    return k;
                }
            }
            throw new IllegalArgumentException("unknown voucher type " + db);
        }

        public VoucherType toProto() {
            return switch (this) {
                case FIXED -> VoucherType.VOUCHER_TYPE_FIXED;
                case PERCENT -> VoucherType.VOUCHER_TYPE_PERCENT;
                case FREE_DELIVERY -> VoucherType.VOUCHER_TYPE_FREE_DELIVERY;
            };
        }
    }

    /** True when every use or the whole budget is taken (redeemed + held). */
    public boolean exhausted() {
        return (useLimit > 0 && uses + heldUses >= useLimit) || (budgetMinor > 0 && spentMinor + reservedMinor >= budgetMinor);
    }

    /** Status as of today: the stored status, with dates applied (the scheduler persists the same transitions). */
    public String effectiveStatus(LocalDate today) {
        if (ENDED.equals(status) || today.isAfter(endsOn)) {
            return ENDED;
        }
        if (PAUSED.equals(status)) {
            return PAUSED;
        }
        return today.isBefore(startsOn) ? SCHEDULED : ACTIVE;
    }

    public VoucherRow withCounters(int uses, int heldUses, long spentMinor, long reservedMinor) {
        return new VoucherRow(code, label, description, type, amountMinor, percent, maxDiscountMinor, minOrderMinor,
                currency, restaurantIds, newCustomersOnly, startsOn, endsOn, uses, heldUses, useLimit,
                perCustomerLimit, budgetMinor, spentMinor, reservedMinor, status, statusReason, fundedBy, createdAt,
                version);
    }

    public VoucherRow withStatus(String status, String reason) {
        return new VoucherRow(code, label, description, type, amountMinor, percent, maxDiscountMinor, minOrderMinor,
                currency, restaurantIds, newCustomersOnly, startsOn, endsOn, uses, heldUses, useLimit,
                perCustomerLimit, budgetMinor, spentMinor, reservedMinor, status, reason, fundedBy, createdAt, version);
    }

    public FundedBy fundedByProto() {
        return "restaurant".equals(fundedBy) ? FundedBy.FUNDED_BY_RESTAURANT : FundedBy.FUNDED_BY_KADE;
    }

    public static VoucherStatus statusProto(String status) {
        return switch (status) {
            case ACTIVE -> VoucherStatus.VOUCHER_STATUS_ACTIVE;
            case SCHEDULED -> VoucherStatus.VOUCHER_STATUS_SCHEDULED;
            case PAUSED -> VoucherStatus.VOUCHER_STATUS_PAUSED;
            case ENDED -> VoucherStatus.VOUCHER_STATUS_ENDED;
            default -> VoucherStatus.VOUCHER_STATUS_UNSPECIFIED;
        };
    }

    public Voucher toProto(Clock clock) {
        return Voucher.newBuilder()
                .setCode(code)
                .setLabel(label)
                .setDescription(description)
                .setType(type.toProto())
                .setAmount(Money.of(amountMinor, currency).toProto())
                .setPercent(percent)
                .setMaxDiscount(Money.of(maxDiscountMinor, currency).toProto())
                .setMinOrder(Money.of(minOrderMinor, currency).toProto())
                .addAllRestaurantIds(restaurantIds)
                .setNewCustomersOnly(newCustomersOnly)
                .setStartsOn(startsOn.toString())
                .setEndsOn(endsOn.toString())
                .setUses(uses)
                .setUseLimit(useLimit)
                .setPerCustomerLimit(perCustomerLimit)
                .setBudget(Money.of(budgetMinor, currency).toProto())
                .setSpent(Money.of(spentMinor, currency).toProto())
                .setReserved(Money.of(reservedMinor, currency).toProto())
                .setStatus(statusProto(effectiveStatus(Colombo.today(clock))))
                .setFundedBy(fundedByProto())
                .setCreatedAt(Colombo.timestamp(createdAt))
                .build();
    }

    /** "Rs 100 off", "15% off, up to Rs 500", "Free delivery". */
    public static String defaultLabel(Kind type, long amountMinor, int percent, long maxDiscountMinor) {
        return switch (type) {
            case FIXED -> Rs.format(amountMinor) + " off";
            case PERCENT -> percent + "% off" + (maxDiscountMinor > 0 ? ", up to " + Rs.format(maxDiscountMinor) : "");
            case FREE_DELIVERY -> "Free delivery";
        };
    }
}
