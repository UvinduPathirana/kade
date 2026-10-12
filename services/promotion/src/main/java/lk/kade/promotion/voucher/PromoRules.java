package lk.kade.promotion.voucher;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.function.Function;
import lk.kade.promotion.money.Money;
import lk.kade.promotion.support.Rs;
import lk.kade.promotion.v1.PromoRejection;
import lk.kade.promotion.v1.PromoResult;

/**
 * The voucher decision, pure: no database, no clock. Same inputs, same answer, so ValidatePromo (cart preview) and
 * ReservePromo (saga) can never disagree about a discount. Messages are the ones the customer app shows.
 */
public final class PromoRules {

    private static final DateTimeFormatter DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);

    private PromoRules() {}

    /** What we know about the customer for this code. {@code known} is false for signed-out previews. */
    public record CustomerFacts(boolean known, boolean firstOrder, int usesOfThisCode) {
        public static final CustomerFacts ANONYMOUS = new CustomerFacts(false, true, 0);
    }

    public record Outcome(PromoResult result, long discountMinor) {
        public boolean ok() {
            return result.getOk();
        }
    }

    public static String normalise(String raw) {
        return raw == null ? "" : raw.strip().toUpperCase(Locale.ROOT);
    }

    public static Outcome evaluate(String rawCode, Optional<VoucherRow> found, BasketView basket, CustomerFacts customer,
            LocalDate today, Function<String, Optional<String>> restaurantName) {
        String code = normalise(rawCode);
        String currency = found.map(VoucherRow::currency).orElse(basket.currency());
        PromoResult.Builder base = PromoResult.newBuilder()
                .setCode(code)
                .setDiscount(Money.zero(currency).toProto())
                .setShortfall(Money.zero(currency).toProto());
        if (code.isEmpty()) {
            return reject(base, PromoRejection.PROMO_REJECTION_EMPTY, "Enter a promo code.");
        }
        if (found.isEmpty()) {
            return reject(base, PromoRejection.PROMO_REJECTION_NOT_FOUND,
                    code + " isn't a Kadé code. Check the spelling and try again.");
        }
        VoucherRow v = found.get();
        base.setLabel(v.label()).setFundedBy(v.fundedByProto());
        String status = v.effectiveStatus(today);
        if (VoucherRow.ENDED.equals(status)) {
            boolean expired = today.isAfter(v.endsOn()) || "expired".equals(v.statusReason());
            if (!expired && ("budget_exhausted".equals(v.statusReason()) || "use_limit_reached".equals(v.statusReason()))) {
                return reject(base, PromoRejection.PROMO_REJECTION_EXHAUSTED,
                        code + " has been fully claimed. Keep an eye out for the next one.");
            }
            return reject(base, PromoRejection.PROMO_REJECTION_EXPIRED,
                    expired ? code + " has expired." : code + " has ended.");
        }
        if (VoucherRow.SCHEDULED.equals(status)) {
            return reject(base, PromoRejection.PROMO_REJECTION_NOT_STARTED,
                    code + " starts on " + DAY_MONTH.format(v.startsOn()) + ".");
        }
        if (VoucherRow.PAUSED.equals(status)) {
            return reject(base, PromoRejection.PROMO_REJECTION_PAUSED, code + " is paused right now. Try again later.");
        }
        if (!v.restaurantIds().isEmpty() && !v.restaurantIds().contains(basket.restaurantId())) {
            return reject(base, PromoRejection.PROMO_REJECTION_WRONG_RESTAURANT,
                    code + " only works at " + where(v.restaurantIds(), restaurantName) + ".");
        }
        if (v.type() == VoucherRow.Kind.FREE_DELIVERY && basket.pickup()) {
            return reject(base, PromoRejection.PROMO_REJECTION_PICKUP_NOT_ELIGIBLE, code + " is for delivery orders only.");
        }
        if (v.newCustomersOnly() && customer.known() && !customer.firstOrder()) {
            return reject(base, PromoRejection.PROMO_REJECTION_NEW_CUSTOMERS_ONLY, code + " is for your first Kadé order.");
        }
        if (customer.known() && v.perCustomerLimit() > 0 && customer.usesOfThisCode() >= v.perCustomerLimit()) {
            return reject(base, PromoRejection.PROMO_REJECTION_ALREADY_USED,
                    v.perCustomerLimit() == 1 ? "You've already used " + code + "."
                            : "You've used " + code + " " + v.perCustomerLimit() + " times, the most it allows.");
        }
        if (basket.subtotalMinor() < v.minOrderMinor()) {
            long shortfall = Rs.ceilRupees(v.minOrderMinor() - basket.subtotalMinor());
            Outcome o = reject(base, PromoRejection.PROMO_REJECTION_MIN_SUBTOTAL,
                    code + " needs an order of " + Rs.format(v.minOrderMinor()) + " or more. Add "
                            + Rs.format(shortfall) + " to use it.");
            return new Outcome(o.result.toBuilder().setShortfall(Money.of(shortfall, currency).toProto()).build(), 0);
        }
        long discount = discount(v, basket);
        if ((v.useLimit() > 0 && v.uses() + v.heldUses() >= v.useLimit())
                || (v.budgetMinor() > 0 && v.spentMinor() + v.reservedMinor() + discount > v.budgetMinor())) {
            return reject(base, PromoRejection.PROMO_REJECTION_EXHAUSTED,
                    code + " has been fully claimed. Keep an eye out for the next one.");
        }
        return new Outcome(base
                .setOk(true)
                .setDiscount(Money.of(discount, currency).toProto())
                .setFreeDelivery(v.type() == VoucherRow.Kind.FREE_DELIVERY)
                .setRejection(PromoRejection.PROMO_REJECTION_UNSPECIFIED)
                .build(), discount);
    }

    /** FIXED: the amount (never more than the food); PERCENT: of the food, whole rupees, capped; FREE_DELIVERY: the fee. */
    public static long discount(VoucherRow v, BasketView basket) {
        long food = basket.foodMinor();
        return switch (v.type()) {
            case FIXED -> Math.min(v.amountMinor(), food);
            case PERCENT -> {
                long d = Rs.percentOfWholeRupees(food, v.percent());
                if (v.maxDiscountMinor() > 0) {
                    d = Math.min(d, v.maxDiscountMinor());
                }
                yield Math.min(d, food);
            }
            case FREE_DELIVERY -> basket.deliveryFeeMinor();
        };
    }

    /** "Galle Road Kottu House", "Hoppers Lane and Rice Bowl", or a count when catalog can't name them. */
    static String where(List<String> restaurantIds, Function<String, Optional<String>> restaurantName) {
        List<String> names = new ArrayList<>();
        for (String id : restaurantIds) {
            Optional<String> name = restaurantName.apply(id);
            if (name.isEmpty()) {
                return restaurantIds.size() == 1 ? "one restaurant" : restaurantIds.size() + " restaurants";
            }
            names.add(name.get());
        }
        if (names.size() == 1) {
            return names.getFirst();
        }
        if (names.size() > 3) {
            return names.size() + " restaurants";
        }
        return String.join(", ", names.subList(0, names.size() - 1)) + " and " + names.getLast();
    }

    /** Offers page line: "At Galle Road Kottu House", "On orders of Rs 1,000 or more", "On any order". */
    public static String detail(VoucherRow v, Function<String, Optional<String>> restaurantName) {
        String text;
        if (!v.restaurantIds().isEmpty()) {
            text = "At " + where(v.restaurantIds(), restaurantName);
            if (v.minOrderMinor() > 0) {
                text += ", on orders of " + Rs.format(v.minOrderMinor()) + " or more";
            }
        } else if (v.minOrderMinor() > 0) {
            text = "On orders of " + Rs.format(v.minOrderMinor()) + " or more";
        } else {
            text = "On any order";
        }
        if (v.newCustomersOnly()) {
            text += ", first order only";
        }
        return text;
    }

    private static Outcome reject(PromoResult.Builder base, PromoRejection rejection, String message) {
        return new Outcome(base.clone().setOk(false).setRejection(rejection).setMessage(message).build(), 0);
    }
}
