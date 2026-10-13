package lk.kade.payment.cards;

import io.grpc.Status;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lk.kade.common.v1.CardBrand;
import lk.kade.payment.error.ServiceException;
import lk.kade.payment.outbox.UuidV7;
import lk.kade.payment.payments.Protos;
import lk.kade.payment.v1.AddSavedCardRequest;
import lk.kade.payment.v1.CreateCardSetupSessionResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Saved cards: PSP tokens plus display details. Never a card number. */
@Service
public class SavedCardService {

    public static final String CARD_NOT_FOUND = "CARD_NOT_FOUND";
    public static final String CARD_ALREADY_SAVED = "CARD_ALREADY_SAVED";
    public static final String CARD_INVALID = "CARD_INVALID";
    public static final String CARD_EXPIRED = "CARD_EXPIRED";
    public static final String SETUP_SESSION_INVALID = "SETUP_SESSION_INVALID";
    public static final String PSP_TOKEN_INVALID = "PSP_TOKEN_INVALID";

    static final Duration SESSION_TTL = Duration.ofMinutes(15);
    private static final ZoneId COLOMBO = ZoneId.of("Asia/Colombo");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final SavedCardRepository cards;
    private final Clock clock;

    public SavedCardService(SavedCardRepository cards, Clock clock) {
        this.cards = cards;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<SavedCard> list(String customerId) {
        return cards.listLive(customerId);
    }

    /**
     * Opens a card-capture session. In dev the PSP is simulated inside payment, so there are no hosted fields:
     * {@code psp_url} is empty and the app derives a test token ({@code tok_test_…}) itself.
     */
    @Transactional
    public CreateCardSetupSessionResponse createSession(String customerId) {
        Instant now = now();
        UUID id = UuidV7.next();
        byte[] secret = new byte[24];
        RANDOM.nextBytes(secret);
        String clientSecret = "seti_" + id.toString().replace("-", "") + "_secret_" + HexFormat.of().formatHex(secret);
        Instant expires = now.plus(SESSION_TTL);
        cards.insertSession(id, customerId, clientSecret, now, expires);
        return CreateCardSetupSessionResponse.newBuilder()
                .setSessionId(id.toString())
                .setClientSecret(clientSecret)
                .setPspUrl("")
                .setExpiresAt(Protos.ts(expires))
                .build();
    }

    @Transactional
    public SavedCard add(String customerId, AddSavedCardRequest req) {
        UUID session = parseUuid(req.getSessionId(), SETUP_SESSION_INVALID, "session_id");
        if (!req.getPspToken().startsWith("tok_") || req.getPspToken().length() > 200) {
            throw ServiceException.invalidArgument(PSP_TOKEN_INVALID, "psp_token is not a token from the PSP");
        }
        if (req.getBrand() == CardBrand.CARD_BRAND_UNSPECIFIED || req.getBrand() == CardBrand.UNRECOGNIZED) {
            throw ServiceException.invalidArgument(CARD_INVALID, "We take Visa, Mastercard and Amex.");
        }
        if (!req.getLast4().matches("\\d{4}")) {
            throw ServiceException.invalidArgument(CARD_INVALID, "last4 must be four digits");
        }
        int month = req.getExpiryMonth();
        int year = req.getExpiryYear();
        if (month < 1 || month > 12 || year < 2000 || year > 2100) {
            throw ServiceException.invalidArgument(CARD_INVALID, "expiry is not a valid month");
        }
        if (YearMonth.of(year, month).isBefore(YearMonth.now(clock.withZone(COLOMBO)))) {
            throw ServiceException.invalidArgument(CARD_EXPIRED, "This card has expired.");
        }
        Instant now = now();
        if (!cards.useSession(session, customerId, now)) {
            throw ServiceException.failedPrecondition(SETUP_SESSION_INVALID,
                    "card setup session is unknown, expired or already used");
        }
        String brand = Protos.brandName(req.getBrand());
        // The PSP's fingerprint identifies the card across tokens; fall back to the display details.
        String fingerprint = req.getFingerprint().isBlank()
                ? "%s-%s-%02d/%02d".formatted(Protos.brandLabel(brand), req.getLast4(), month, year % 100)
                : req.getFingerprint().strip();
        SavedCard card = new SavedCard(UuidV7.next(), customerId, brand, req.getLast4(), month, year,
                req.getHolderName().strip(), req.getPspToken(), fingerprint, now, null);
        if (!cards.insert(card)) {
            throw new ServiceException(Status.Code.ALREADY_EXISTS, CARD_ALREADY_SAVED,
                    card.label() + " is already saved.");
        }
        return card;
    }

    @Transactional
    public void remove(String customerId, String cardId) {
        UUID id = parseUuid(cardId, CARD_NOT_FOUND, "card_id");
        if (!cards.markRemoved(id, customerId, now())) {
            throw ServiceException.notFound(CARD_NOT_FOUND, "card " + cardId + " not found");
        }
    }

    /** A live card of this customer, by id. */
    @Transactional(readOnly = true)
    public Optional<SavedCard> findLive(String customerId, String cardId) {
        Optional<UUID> id = tryUuid(cardId);
        return id.flatMap(cards::find).filter(c -> c.customerId().equals(customerId) && c.removedAt() == null);
    }

    /** The app pays with "Visa •••• 4242": a live card of this customer by brand and last four. */
    @Transactional(readOnly = true)
    public Optional<SavedCard> findLiveByDisplay(String customerId, CardBrand brand, String last4) {
        String b = Protos.brandName(brand);
        return cards.listLive(customerId).stream()
                .filter(c -> c.last4().equals(last4) && (b.isEmpty() || c.brand().equals(b)))
                .findFirst();
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    static Optional<UUID> tryUuid(String raw) {
        try {
            return raw == null || raw.isEmpty() ? Optional.empty() : Optional.of(UUID.fromString(raw));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private static UUID parseUuid(String raw, String reason, String field) {
        return tryUuid(raw).orElseThrow(() -> ServiceException.invalidArgument(reason, field + " must be a UUID"));
    }
}
