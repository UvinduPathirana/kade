package lk.kade.ledger.db;

import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;
import lk.kade.ledger.error.OptimisticLockException;

/**
 * Re-runs a whole read-decide-write transaction when it loses an optimistic-lock race. Call it from <b>outside</b>
 * the transaction (e.g. in the gRPC adapter around a {@code @Transactional} service method) so every attempt reads
 * fresh rows. Kafka consumers don't need it: the error handler already retries with backoff.
 */
public final class OptimisticRetry {

    private OptimisticRetry() {}

    public static <T> T run(int attempts, Supplier<T> transaction) {
        for (int attempt = 1; ; attempt++) {
            try {
                return transaction.get();
            } catch (OptimisticLockException e) {
                if (attempt >= attempts) {
                    throw e; // surfaces as ABORTED / CONCURRENT_MODIFICATION
                }
                try {
                    Thread.sleep(ThreadLocalRandom.current().nextLong(1, 5L * attempt + 1)); // jitter, de-sync racers
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
            }
        }
    }
}
