package lk.kade.promotion.voucher;

import lk.kade.common.v1.FulfilmentMode;
import lk.kade.promotion.money.Money;
import lk.kade.promotion.v1.Basket;
import lk.kade.promotion.v1.BasketLine;

/** The numbers a promo decision needs from a {@link Basket}, in minor units. */
public record BasketView(String restaurantId, long subtotalMinor, long savingMinor, long deliveryFeeMinor,
        boolean pickup, String currency) {

    public static BasketView of(Basket basket) {
        String currency = Money.LKR;
        long subtotal;
        if (basket.hasSubtotal()) {
            subtotal = basket.getSubtotal().getAmountMinor();
            if (!basket.getSubtotal().getCurrency().isEmpty()) {
                currency = basket.getSubtotal().getCurrency();
            }
        } else {
            subtotal = 0;
            for (BasketLine l : basket.getLinesList()) {
                subtotal = Math.addExact(subtotal, Math.multiplyExact(l.getUnitPrice().getAmountMinor(), (long) l.getQuantity()));
            }
        }
        return new BasketView(
                basket.getRestaurantId(),
                Math.max(0, subtotal),
                Math.max(0, basket.getSaving().getAmountMinor()),
                Math.max(0, basket.getDeliveryFee().getAmountMinor()),
                basket.getMode() == FulfilmentMode.FULFILMENT_MODE_PICKUP,
                currency);
    }

    /** What vouchers apply to: the food after the restaurant's own saving. */
    public long foodMinor() {
        return Math.max(0, subtotalMinor - savingMinor);
    }
}
