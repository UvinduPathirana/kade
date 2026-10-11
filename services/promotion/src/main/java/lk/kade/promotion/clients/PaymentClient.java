package lk.kade.promotion.clients;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import java.util.concurrent.TimeUnit;
import lk.kade.common.v1.CardBrand;
import lk.kade.common.v1.PaymentMethod;
import lk.kade.common.v1.PaymentMethodKind;
import lk.kade.payment.v1.AuthorisePaymentRequest;
import lk.kade.payment.v1.CapturePaymentRequest;
import lk.kade.payment.v1.ListSavedCardsRequest;
import lk.kade.payment.v1.Payment;
import lk.kade.payment.v1.PaymentPurpose;
import lk.kade.payment.v1.PaymentServiceGrpc;
import lk.kade.payment.v1.PaymentStatus;
import lk.kade.payment.v1.SavedCard;
import lk.kade.payment.v1.SavedCardServiceGrpc;
import lk.kade.promotion.error.ServiceException;
import lk.kade.promotion.money.Money;
import org.springframework.stereotype.Component;

/**
 * Charges a gift card to a saved card: AuthorisePayment (purpose GIFT_CARD) then CapturePayment, both idempotent on
 * keys derived from the gift card. PAYMENT_MODE=stub mirrors the order service's stub: cards ending 0002 decline,
 * every other card succeeds.
 */
@Component
public class PaymentClient {

    public static final String PAYMENT_DECLINED = "PAYMENT_DECLINED";
    public static final String CARD_NOT_FOUND = "GIFT_CARD_PAYMENT_CARD_REQUIRED";
    static final String STUB_DECLINING_LAST4 = "0002";

    private final DependencyProperties deps;
    private final PaymentServiceGrpc.PaymentServiceBlockingStub payments;
    private final SavedCardServiceGrpc.SavedCardServiceBlockingStub cards;

    public PaymentClient(Channels channels, DependencyProperties deps) {
        this.deps = deps;
        if (deps.paymentStubbed()) {
            this.payments = null;
            this.cards = null;
        } else {
            var channel = channels.open(deps.paymentGrpc());
            this.payments = PaymentServiceGrpc.newBlockingStub(channel);
            this.cards = SavedCardServiceGrpc.newBlockingStub(channel);
        }
    }

    /** A charged gift card: the payment id and the card label to show ("Visa •••• 4242"). */
    public record Charge(String paymentId, String cardLabel) {}

    public Charge chargeGiftCard(String customerId, String giftCardId, String cardId, Money amount, String keyPrefix) {
        if (payments == null) {
            return stubCharge(giftCardId, cardId);
        }
        try {
            SavedCard card = cards.withDeadlineAfter(ms(), TimeUnit.MILLISECONDS)
                    .listSavedCards(ListSavedCardsRequest.newBuilder().setCustomerId(customerId).build())
                    .getCardsList().stream()
                    .filter(c -> c.getId().equals(cardId))
                    .findFirst()
                    .orElseThrow(() -> ServiceException.invalidArgument(CARD_NOT_FOUND, "Choose a card to pay with."));
            Payment authorised = payments.withDeadlineAfter(ms(), TimeUnit.MILLISECONDS)
                    .authorisePayment(AuthorisePaymentRequest.newBuilder()
                            .setPurpose(PaymentPurpose.PAYMENT_PURPOSE_GIFT_CARD)
                            .setReferenceId(giftCardId)
                            .setReferenceLabel("Kadé gift card")
                            .setCustomerId(customerId)
                            .setMethod(PaymentMethod.newBuilder()
                                    .setKind(PaymentMethodKind.PAYMENT_METHOD_KIND_CARD)
                                    .setCardId(card.getId())
                                    .setCardBrand(card.getBrand())
                                    .setCardLast4(card.getLast4()))
                            .setAmount(amount.toProto())
                            .setIdempotencyKey(keyPrefix + ":authorise")
                            .build())
                    .getPayment();
            if (authorised.getStatus() != PaymentStatus.PAYMENT_STATUS_AUTHORISED
                    && authorised.getStatus() != PaymentStatus.PAYMENT_STATUS_CAPTURED) {
                String message = authorised.getDeclineMessage().isEmpty()
                        ? "Your bank declined this card. Try another card."
                        : authorised.getDeclineMessage();
                throw ServiceException.failedPrecondition(PAYMENT_DECLINED, message);
            }
            if (authorised.getStatus() == PaymentStatus.PAYMENT_STATUS_AUTHORISED) {
                payments.withDeadlineAfter(ms(), TimeUnit.MILLISECONDS)
                        .capturePayment(CapturePaymentRequest.newBuilder()
                                .setPaymentId(authorised.getId())
                                .setIdempotencyKey(keyPrefix + ":capture")
                                .build());
            }
            return new Charge(authorised.getId(), label(card.getBrand(), card.getLast4()));
        } catch (StatusRuntimeException e) {
            if (e.getStatus().getCode() == Status.Code.FAILED_PRECONDITION) {
                throw ServiceException.failedPrecondition(PAYMENT_DECLINED, "Your bank declined this card. Try another card.");
            }
            throw new ServiceException(Status.Code.UNAVAILABLE, "PAYMENT_UNAVAILABLE",
                    "payment failed: " + e.getStatus());
        }
    }

    private long ms() {
        return deps.deadline().toMillis();
    }

    static Charge stubCharge(String giftCardId, String cardId) {
        if (cardId == null || cardId.isBlank()) {
            throw ServiceException.invalidArgument(CARD_NOT_FOUND, "Choose a card to pay with.");
        }
        String digits = cardId.replaceAll("\\D", "");
        String last4 = digits.length() >= 4 ? digits.substring(digits.length() - 4) : "4242";
        if (last4.equals(STUB_DECLINING_LAST4)) {
            throw ServiceException.failedPrecondition(PAYMENT_DECLINED,
                    "Your bank declined Mastercard •••• 0002. Try another card.");
        }
        String brand = cardId.toLowerCase().startsWith("mc") ? "Mastercard" : "Visa";
        return new Charge("stub-pay-giftcard-" + giftCardId, brand + " •••• " + last4);
    }

    static String label(CardBrand brand, String last4) {
        String name = switch (brand) {
            case CARD_BRAND_VISA -> "Visa";
            case CARD_BRAND_MASTERCARD -> "Mastercard";
            case CARD_BRAND_AMEX -> "Amex";
            default -> "Card";
        };
        return name + " •••• " + last4;
    }
}
