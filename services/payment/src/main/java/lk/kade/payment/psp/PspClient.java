package lk.kade.payment.psp;

import io.grpc.Status;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.function.Supplier;
import lk.kade.payment.error.ServiceException;
import lk.kade.payment.money.Money;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The only way domain code reaches the PSP. Adds what a remote PSP needs:
 * <ul>
 *   <li><b>Retries with backoff</b> for {@link PspUnavailableException} (safe: every PSP call is idempotent on our ids).
 *   <li><b>A circuit breaker</b>: after {@code failureThreshold} consecutive failed calls (each after its retries) it
 *       opens for {@code openFor}, failing fast with {@code UNAVAILABLE / PSP_UNAVAILABLE} instead of piling up
 *       requests; then one trial call (half-open) decides whether it closes again.
 * </ul>
 * Declines are results, so they never count as failures.
 */
@Component
public class PspClient {

    public static final String PSP_UNAVAILABLE = "PSP_UNAVAILABLE";

    private static final Logger log = LoggerFactory.getLogger(PspClient.class);

    private final Psp psp;
    private final Clock clock;
    private final int attempts;
    private final Duration backoff;
    private final int failureThreshold;
    private final Duration openFor;

    private int consecutiveFailures;
    private Instant openUntil = Instant.MIN;
    private boolean trialInFlight;

    public PspClient(Psp psp, Clock clock,
                     @Value("${kade.psp.attempts:3}") int attempts,
                     @Value("${kade.psp.backoff:100ms}") Duration backoff,
                     @Value("${kade.psp.breaker-threshold:5}") int failureThreshold,
                     @Value("${kade.psp.breaker-open-for:15s}") Duration openFor) {
        this.psp = psp;
        this.clock = clock;
        this.attempts = attempts;
        this.backoff = backoff;
        this.failureThreshold = failureThreshold;
        this.openFor = openFor;
    }

    public Psp.Authorisation authorise(String paymentId, Psp.Card card, Money amount) {
        return call("authorise", () -> psp.authorise(paymentId, card, amount));
    }

    public Psp.Authorisation adjust(String pspReference, Psp.Card card, Money amount) {
        return call("adjust", () -> psp.adjust(pspReference, card, amount));
    }

    public void capture(String pspReference, Money amount) {
        call("capture", () -> { psp.capture(pspReference, amount); return null; });
    }

    public void voidAuthorisation(String pspReference) {
        call("void", () -> { psp.voidAuthorisation(pspReference); return null; });
    }

    public String refund(String pspReference, String refundId, Money amount) {
        return call("refund", () -> psp.refund(pspReference, refundId, amount));
    }

    /** True while the breaker is open (for health/metrics and tests). */
    public synchronized boolean isOpen() {
        return clock.instant().isBefore(openUntil);
    }

    private <T> T call(String op, Supplier<T> action) {
        admit(op);
        PspUnavailableException last = null;
        for (int attempt = 1; attempt <= attempts; attempt++) {
            try {
                T result = action.get();
                onSuccess();
                return result;
            } catch (PspUnavailableException e) {
                last = e;
                log.warn("psp {} attempt {}/{} failed: {}", op, attempt, attempts, e.getMessage());
                if (attempt < attempts) {
                    sleep(backoff.multipliedBy(1L << (attempt - 1)));
                }
            }
        }
        onFailure(op);
        throw last;
    }

    private synchronized void admit(String op) {
        Instant now = clock.instant();
        if (now.isBefore(openUntil)) {
            throw breakerOpen(op);
        }
        if (consecutiveFailures >= failureThreshold) {
            // Half-open: let exactly one trial call through.
            if (trialInFlight) {
                throw breakerOpen(op);
            }
            trialInFlight = true;
        }
    }

    private synchronized void onSuccess() {
        consecutiveFailures = 0;
        trialInFlight = false;
    }

    private synchronized void onFailure(String op) {
        consecutiveFailures++;
        trialInFlight = false;
        if (consecutiveFailures >= failureThreshold) {
            openUntil = clock.instant().plus(openFor);
            log.error("psp circuit breaker OPEN for {} after {} consecutive failures ({})", openFor, consecutiveFailures, op);
        }
    }

    private static ServiceException breakerOpen(String op) {
        return new ServiceException(Status.Code.UNAVAILABLE, PSP_UNAVAILABLE,
                "payment provider unavailable (circuit open) for " + op);
    }

    private static void sleep(Duration d) {
        try {
            Thread.sleep(d.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PspUnavailableException("interrupted");
        }
    }
}
