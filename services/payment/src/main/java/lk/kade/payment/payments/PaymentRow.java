package lk.kade.payment.payments;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lk.kade.common.v1.PaymentMethod;
import lk.kade.common.v1.PaymentMethodKind;
import lk.kade.payment.money.Money;
import lk.kade.payment.v1.Payment;
import lk.kade.payment.v1.PaymentPurpose;
import lk.kade.payment.v1.PaymentStatus;

/**
 * One payment, as read from {@code payments} with its {@code version}. Domain code changes it in memory, then
 * {@link PaymentRepository#update} writes it only if nobody else changed the row since it was read.
 */
public final class PaymentRow {

    public UUID id;
    public String purpose;          // ORDER | PLUS_SUBSCRIPTION | GIFT_CARD
    public String referenceId;
    public String referenceLabel;
    public String customerId;
    public String methodKind;       // CARD | CASH
    public UUID cardId;
    public String cardBrand = "";
    public String cardLast4 = "";
    public Long cashPayingWithMinor;
    public String currency;
    public String status;           // PaymentStatus without the prefix
    public long requestedMinor;
    public long authorisedMinor;
    public long capturedMinor;
    public long refundedMinor;
    public String pspReference = "";
    public String declineCode = "";
    public String declineMessage = "";
    public String collectedByRiderId = "";
    public String deliveryId = "";
    public long version;
    public Instant createdAt;
    public Instant authorisedAt;
    public Instant capturedAt;
    public Instant voidedAt;

    public boolean isCash() {
        return "CASH".equals(methodKind);
    }

    public boolean is(String s) {
        return s.equals(status);
    }

    public Money requested() { return Money.of(requestedMinor, currency); }
    public Money authorised() { return Money.of(authorisedMinor, currency); }
    public Money captured() { return Money.of(capturedMinor, currency); }
    public Money refunded() { return Money.of(refundedMinor, currency); }

    public PaymentPurpose purposeProto() {
        return PaymentPurpose.valueOf("PAYMENT_PURPOSE_" + purpose);
    }

    public PaymentMethodKind methodKindProto() {
        return PaymentMethodKind.valueOf("PAYMENT_METHOD_KIND_" + methodKind);
    }

    public PaymentStatus statusProto() {
        return PaymentStatus.valueOf("PAYMENT_STATUS_" + status);
    }

    public PaymentMethod methodProto() {
        PaymentMethod.Builder m = PaymentMethod.newBuilder().setKind(methodKindProto());
        if (cardId != null) {
            m.setCardId(cardId.toString()).setCardBrand(Protos.brand(cardBrand)).setCardLast4(cardLast4);
        }
        if (cashPayingWithMinor != null) {
            m.setCashPayingWith(Money.of(cashPayingWithMinor, currency).toProto());
        }
        return m.build();
    }

    public Payment toProto(List<RefundRow> refunds) {
        Payment.Builder p = Payment.newBuilder()
                .setId(id.toString())
                .setPurpose(purposeProto())
                .setReferenceId(referenceId)
                .setReferenceLabel(referenceLabel)
                .setCustomerId(customerId)
                .setMethod(methodProto())
                .setStatus(statusProto())
                .setAmountAuthorised(authorised().toProto())
                .setAmountCaptured(captured().toProto())
                .setAmountRefunded(refunded().toProto())
                .setPspReference(pspReference)
                .setDeclineCode(declineCode)
                .setDeclineMessage(declineMessage)
                .setCollectedByRiderId(collectedByRiderId)
                .setCreatedAt(Protos.ts(createdAt));
        refunds.forEach(r -> p.addRefunds(r.toProto()));
        if (authorisedAt != null) p.setAuthorisedAt(Protos.ts(authorisedAt));
        if (capturedAt != null) p.setCapturedAt(Protos.ts(capturedAt));
        if (voidedAt != null) p.setVoidedAt(Protos.ts(voidedAt));
        return p.build();
    }
}
