package lk.kade.payment.psp;

import lk.kade.payment.money.Money;

/**
 * What payment needs from a payment service provider. Every call is idempotent on the ids we pass (a real PSP takes
 * an idempotency key; the mock derives its references from them), so retries never double-charge.
 * Transient failures throw {@link PspUnavailableException}; declines are results, not exceptions.
 */
public interface Psp {

    /** Places a hold of {@code amount} on the tokenised card. */
    Authorisation authorise(String paymentId, Card card, Money amount);

    /** Changes the amount held (tip changed after placing). */
    Authorisation adjust(String pspReference, Card card, Money amount);

    void capture(String pspReference, Money amount);

    void voidAuthorisation(String pspReference);

    /** @return the PSP refund reference */
    String refund(String pspReference, String refundId, Money amount);

    /** What the PSP knows about a card. Never a card number: Kadé only holds the token and display details. */
    record Card(String token, String last4, int expiryMonth, int expiryYear) {}

    enum Outcome { APPROVED, DECLINED, PENDING }

    record Authorisation(Outcome outcome, String pspReference, String declineCode) {

        public static Authorisation approved(String ref) {
            return new Authorisation(Outcome.APPROVED, ref, "");
        }

        public static Authorisation declined(String ref, String code) {
            return new Authorisation(Outcome.DECLINED, ref, code);
        }

        public static Authorisation pending(String ref) {
            return new Authorisation(Outcome.PENDING, ref, "");
        }
    }
}
