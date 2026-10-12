package lk.kade.payment.psp;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Duration;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import lk.kade.payment.money.Money;
import lk.kade.payment.outbox.UuidV7;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * A simulated PSP that lives inside the service: no network calls, deterministic outcomes by card. The card's last
 * four digits pick the behaviour, mirroring the card networks' public test numbers:
 *
 * <pre>
 *   4242 4242 4242 4242 (and any other card)  approved
 *   …0002                                     declined, card_declined
 *   …9995                                     declined, insufficient_funds
 *   …0069                                     declined, expired_card (also any card past its expiry month)
 *   …0127                                     declined, incorrect_cvc
 *   …3155                                     3-D Secure: PENDING, then approved by webhook
 *   …3220                                     3-D Secure: PENDING, then declined (authentication_failed) by webhook
 *   …0119                                     processing_error on every attempt (PSP outage → FAILED)
 * </pre>
 *
 * References are derived from our ids ({@code mockpsp_ch_<payment id>}), so every call is idempotent the way a real
 * PSP's idempotency keys make it. Asynchronous outcomes are delivered as signed webhooks to {@link WebhookSink}, the
 * same path the HTTP endpoint {@code POST /psp/webhooks/mockpsp} uses.
 */
@Component
public class MockPsp implements Psp, DisposableBean {

    public static final String PROVIDER = "mockpsp";
    static final ZoneId COLOMBO = ZoneId.of("Asia/Colombo");

    private static final Logger log = LoggerFactory.getLogger(MockPsp.class);

    private final Clock clock;
    private final WebhookSigner signer;
    private final ObjectProvider<WebhookSink> sink;
    private final ObjectMapper json = new ObjectMapper();
    private final Duration pendingDelay;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "mockpsp-webhooks");
        t.setDaemon(true);
        return t;
    });
    /** Charges with a webhook still to be sent (dedupes repeated authorise calls for the same payment). */
    private final Set<String> pendingWebhooks = ConcurrentHashMap.newKeySet();

    public MockPsp(Clock clock, WebhookSigner signer, ObjectProvider<WebhookSink> sink,
                   @Value("${kade.psp.pending-delay:3s}") Duration pendingDelay) {
        this.clock = clock;
        this.signer = signer;
        this.sink = sink;
        this.pendingDelay = pendingDelay;
    }

    public static String chargeReference(String paymentId) {
        return "mockpsp_ch_" + paymentId.replace("-", "");
    }

    @Override
    public Authorisation authorise(String paymentId, Card card, Money amount) {
        String ref = chargeReference(paymentId);
        if (!card.token().startsWith("tok_")) {
            return Authorisation.declined(ref, "invalid_token");
        }
        if (YearMonth.of(card.expiryYear(), card.expiryMonth()).isBefore(YearMonth.now(clock.withZone(COLOMBO)))) {
            return Authorisation.declined(ref, "expired_card");
        }
        return switch (card.last4()) {
            case "0002" -> Authorisation.declined(ref, "card_declined");
            case "9995" -> Authorisation.declined(ref, "insufficient_funds");
            case "0069" -> Authorisation.declined(ref, "expired_card");
            case "0127" -> Authorisation.declined(ref, "incorrect_cvc");
            case "0119" -> throw new PspUnavailableException("mockpsp: processing_error");
            case "3155" -> pendingThen(paymentId, ref, "charge.succeeded", "");
            case "3220" -> pendingThen(paymentId, ref, "charge.failed", "authentication_failed");
            default -> Authorisation.approved(ref);
        };
    }

    @Override
    public Authorisation adjust(String pspReference, Card card, Money amount) {
        if ("0119".equals(card.last4())) {
            throw new PspUnavailableException("mockpsp: processing_error");
        }
        return Authorisation.approved(pspReference);
    }

    @Override
    public void capture(String pspReference, Money amount) {
        requireReference(pspReference);
    }

    @Override
    public void voidAuthorisation(String pspReference) {
        requireReference(pspReference);
    }

    @Override
    public String refund(String pspReference, String refundId, Money amount) {
        requireReference(pspReference);
        return "mockpsp_re_" + refundId.replace("-", "");
    }

    private static void requireReference(String pspReference) {
        if (pspReference == null || pspReference.isEmpty()) {
            throw new IllegalArgumentException("mockpsp: no such charge");
        }
    }

    /** 3-D Secure: answer PENDING now, deliver the outcome by webhook a little later. */
    private Authorisation pendingThen(String paymentId, String ref, String eventType, String declineCode) {
        if (pendingWebhooks.add(ref)) {
            scheduler.schedule(() -> deliver(paymentId, ref, eventType, declineCode, 1),
                    pendingDelay.toMillis(), TimeUnit.MILLISECONDS);
        }
        return Authorisation.pending(ref);
    }

    private void deliver(String paymentId, String ref, String eventType, String declineCode, int attempt) {
        try {
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("id", "evt_" + UuidV7.next().toString().replace("-", ""));
            event.put("type", eventType);
            event.put("payment_id", paymentId);
            event.put("psp_reference", ref);
            event.put("decline_code", declineCode);
            event.put("created", clock.instant().getEpochSecond());
            byte[] payload = json.writeValueAsBytes(event);
            sink.getObject().deliver(PROVIDER, signer.sign(payload), payload);
            pendingWebhooks.remove(ref);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        } catch (RuntimeException e) {
            // Real PSPs retry webhooks with backoff; so does the mock (5 attempts, then it gives up).
            if (attempt >= 5) {
                log.error("mockpsp webhook {} for {} failed {} times, giving up", eventType, paymentId, attempt, e);
                pendingWebhooks.remove(ref);
                return;
            }
            log.warn("mockpsp webhook {} for {} failed, retrying: {}", eventType, paymentId, e.toString());
            scheduler.schedule(() -> deliver(paymentId, ref, eventType, declineCode, attempt + 1),
                    2L << attempt, TimeUnit.SECONDS);
        }
    }

    @Override
    public void destroy() {
        scheduler.shutdownNow();
    }
}
