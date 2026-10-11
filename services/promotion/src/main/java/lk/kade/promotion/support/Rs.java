package lk.kade.promotion.support;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.Locale;

/** User-facing rupee amounts, as the apps print them: "Rs 1,150", "Rs 99.50". */
public final class Rs {

    private Rs() {}

    public static String format(long minor) {
        DecimalFormat f = new DecimalFormat(minor % 100 == 0 ? "#,##0" : "#,##0.00", DecimalFormatSymbols.getInstance(Locale.ENGLISH));
        return "Rs " + f.format(BigDecimal.valueOf(minor).movePointLeft(2));
    }

    /** Rounds up to whole rupees ("add Rs 250 to use it" never under-states the gap). */
    public static long ceilRupees(long minor) {
        return Math.floorDiv(minor + 99, 100) * 100;
    }

    /** {@code minor × percent / 100}, rounded half-up to whole rupees (the apps' Math.round on rupees). */
    public static long percentOfWholeRupees(long minor, int percent) {
        BigDecimal rupees = BigDecimal.valueOf(minor).multiply(BigDecimal.valueOf(percent))
                .divide(BigDecimal.valueOf(10_000), 0, RoundingMode.HALF_UP);
        return rupees.longValueExact() * 100;
    }
}
