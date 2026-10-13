package lk.kade.payment.payments;

import java.time.Instant;
import java.util.UUID;
import lk.kade.payment.money.Money;
import lk.kade.payment.v1.PaymentRefund;
import lk.kade.payment.v1.RefundStatus;

public record RefundRow(
        UUID id, UUID paymentId, Money amount, String reason, String orderRefundId, String status,
        String pspReference, Instant createdAt, Instant completedAt) {

    public PaymentRefund toProto() {
        PaymentRefund.Builder r = PaymentRefund.newBuilder()
                .setId(id.toString())
                .setPaymentId(paymentId.toString())
                .setAmount(amount.toProto())
                .setReason(reason)
                .setStatus(RefundStatus.valueOf("REFUND_STATUS_" + status))
                .setPspReference(pspReference)
                .setCreatedAt(Protos.ts(createdAt));
        if (completedAt != null) r.setCompletedAt(Protos.ts(completedAt));
        return r.build();
    }
}
