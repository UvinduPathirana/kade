package lk.kade.promotion.voucher;

import java.time.Instant;
import java.util.UUID;
import lk.kade.promotion.money.Money;
import lk.kade.promotion.support.Colombo;
import lk.kade.promotion.v1.FundedBy;
import lk.kade.promotion.v1.PromoReservation;
import lk.kade.promotion.v1.ReservationStatus;

/** A discount held against a voucher for one order. */
public record Reservation(UUID id, String code, String customerId, String orderId, long discountMinor, String currency,
        String fundedBy, String status, String reason, Instant expiresAt) {

    public static final String HELD = "held";
    public static final String REDEEMED = "redeemed";
    public static final String RELEASED = "released";
    public static final String EXPIRED = "expired";

    public Reservation withStatus(String status, String reason) {
        return new Reservation(id, code, customerId, orderId, discountMinor, currency, fundedBy, status, reason, expiresAt);
    }

    public PromoReservation toProto() {
        return PromoReservation.newBuilder()
                .setId(id.toString())
                .setCode(code)
                .setCustomerId(customerId)
                .setOrderId(orderId)
                .setDiscount(Money.of(discountMinor, currency).toProto())
                .setFundedBy("restaurant".equals(fundedBy) ? FundedBy.FUNDED_BY_RESTAURANT : FundedBy.FUNDED_BY_KADE)
                .setStatus(switch (status) {
                    case HELD -> ReservationStatus.RESERVATION_STATUS_HELD;
                    case REDEEMED -> ReservationStatus.RESERVATION_STATUS_REDEEMED;
                    case RELEASED -> ReservationStatus.RESERVATION_STATUS_RELEASED;
                    case EXPIRED -> ReservationStatus.RESERVATION_STATUS_EXPIRED;
                    default -> ReservationStatus.RESERVATION_STATUS_UNSPECIFIED;
                })
                .setExpiresAt(Colombo.timestamp(expiresAt))
                .build();
    }
}
