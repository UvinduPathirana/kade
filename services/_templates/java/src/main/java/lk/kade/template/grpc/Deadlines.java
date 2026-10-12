package lk.kade.template.grpc;

import io.grpc.Context;
import io.grpc.Deadline;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import lk.kade.template.error.ErrorReasons;
import lk.kade.template.error.ServiceException;

/** Helpers for honouring the caller's deadline inside handlers. */
public final class Deadlines {

    private Deadlines() {}

    /** Throws DEADLINE_EXCEEDED if the caller has already given up (deadline passed or call cancelled). */
    public static void check() {
        Context ctx = Context.current();
        if (ctx.isCancelled()) {
            throw new ServiceException(io.grpc.Status.Code.DEADLINE_EXCEEDED, ErrorReasons.DEADLINE_EXCEEDED,
                    "caller deadline exceeded or call cancelled");
        }
    }

    /** Time left on the current call, or {@code fallback} outside a gRPC call (e.g. Kafka consumers). */
    public static Duration remaining(Duration fallback) {
        Deadline d = Context.current().getDeadline();
        return d == null ? fallback : Duration.ofNanos(Math.max(0, d.timeRemaining(TimeUnit.NANOSECONDS)));
    }
}
