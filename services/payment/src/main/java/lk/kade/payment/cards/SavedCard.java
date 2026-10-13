package lk.kade.payment.cards;

import java.time.Instant;
import java.util.UUID;
import lk.kade.payment.payments.Protos;
import lk.kade.payment.psp.Psp;

/** A tokenised card. {@code pspToken} is what the PSP charges; it never leaves payment. */
public record SavedCard(
        UUID id, String customerId, String brand, String last4, int expiryMonth, int expiryYear, String holderName,
        String pspToken, String fingerprint, Instant addedAt, Instant removedAt) {

    public lk.kade.payment.v1.SavedCard toProto() {
        return lk.kade.payment.v1.SavedCard.newBuilder()
                .setId(id.toString())
                .setCustomerId(customerId)
                .setBrand(Protos.brand(brand))
                .setLast4(last4)
                .setExpiryMonth(expiryMonth)
                .setExpiryYear(expiryYear)
                .setHolderName(holderName)
                .setAddedAt(Protos.ts(addedAt))
                .build();
    }

    public Psp.Card forPsp() {
        return new Psp.Card(pspToken, last4, expiryMonth, expiryYear);
    }

    /** "Visa ending 4242". */
    public String label() {
        return Protos.brandLabel(brand) + " ending " + last4;
    }
}
