package lk.kade.payment.payments;

import com.google.protobuf.Timestamp;
import java.time.Instant;
import lk.kade.common.v1.CardBrand;

/** Small mapping helpers between rows and protos. */
public final class Protos {

    private Protos() {}

    public static Timestamp ts(Instant t) {
        return Timestamp.newBuilder().setSeconds(t.getEpochSecond()).setNanos(t.getNano()).build();
    }

    /** Proto enum constant → the short name stored in the database ("CARD_BRAND_VISA" → "VISA"). */
    public static String shortName(Enum<?> value, String prefix) {
        String name = value.name();
        return name.startsWith(prefix) ? name.substring(prefix.length()) : name;
    }

    public static String brandName(CardBrand brand) {
        return brand == CardBrand.CARD_BRAND_UNSPECIFIED || brand == CardBrand.UNRECOGNIZED
                ? "" : shortName(brand, "CARD_BRAND_");
    }

    public static CardBrand brand(String stored) {
        if (stored == null || stored.isEmpty()) {
            return CardBrand.CARD_BRAND_UNSPECIFIED;
        }
        return CardBrand.valueOf("CARD_BRAND_" + stored);
    }

    /** "Visa", "Mastercard", "Amex": how the apps name cards. */
    public static String brandLabel(String stored) {
        return switch (stored == null ? "" : stored) {
            case "VISA" -> "Visa";
            case "MASTERCARD" -> "Mastercard";
            case "AMEX" -> "Amex";
            default -> "Card";
        };
    }
}
