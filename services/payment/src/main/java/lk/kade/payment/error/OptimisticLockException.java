package lk.kade.payment.error;

import io.grpc.Status;

/**
 * A versioned row changed between our read and our write ({@code UPDATE ... WHERE version = ?} hit 0 rows).
 * Maps to ABORTED, which per gRPC semantics means "retry the whole read-modify-write"; Kafka consumers retry it
 * automatically through the error handler's backoff.
 */
public class OptimisticLockException extends ServiceException {

    public OptimisticLockException(String table, Object id, long expectedVersion) {
        super(Status.Code.ABORTED, ErrorReasons.CONCURRENT_MODIFICATION,
                "%s %s was modified concurrently (expected version %d)".formatted(table, id, expectedVersion));
    }
}
