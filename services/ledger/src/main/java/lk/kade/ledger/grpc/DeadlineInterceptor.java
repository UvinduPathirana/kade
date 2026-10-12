package lk.kade.ledger.grpc;

import io.grpc.Context;
import io.grpc.Deadline;
import io.grpc.ForwardingServerCallListener;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import lk.kade.ledger.config.KadeProperties;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.grpc.server.GlobalServerInterceptor;
import org.springframework.stereotype.Component;

/**
 * Every call runs under a deadline (CONVENTIONS: default 2 s). Calls without one get the default, overly long ones
 * are clamped, and already-expired ones are rejected before any work starts. Handlers call
 * {@link Deadlines#check()} before expensive steps. If the caller gives up after we commit, its retry with the same
 * idempotency key gets the stored response, so a late commit is never a double effect.
 */
@Component
@GlobalServerInterceptor
@Order(Ordered.HIGHEST_PRECEDENCE + 50)
public class DeadlineInterceptor implements ServerInterceptor {

    private static final ServerCall.Listener<Object> NOOP = new ServerCall.Listener<>() {};

    private final long defaultNanos;
    private final long maxNanos;
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().daemon().name("grpc-deadlines").factory());

    public DeadlineInterceptor(KadeProperties props) {
        this.defaultNanos = props.grpc().defaultDeadline().toNanos();
        this.maxNanos = props.grpc().maxDeadline().toNanos();
    }

    @Override
    @SuppressWarnings("unchecked")
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
        Deadline incoming = Context.current().getDeadline();
        if (incoming != null && incoming.isExpired()) {
            call.close(Status.DEADLINE_EXCEEDED.withDescription("deadline expired before the call started"), new Metadata());
            return (ServerCall.Listener<ReqT>) NOOP;
        }
        long budget = incoming == null ? defaultNanos : Math.min(incoming.timeRemaining(TimeUnit.NANOSECONDS), maxNanos);
        Context.CancellableContext ctx = Context.current().withDeadlineAfter(budget, TimeUnit.NANOSECONDS, scheduler);
        Context previous = ctx.attach();
        ServerCall.Listener<ReqT> delegate;
        try {
            delegate = next.startCall(call, headers);
        } finally {
            ctx.detach(previous);
        }
        return new ForwardingServerCallListener.SimpleForwardingServerCallListener<>(delegate) {
            private void run(Runnable r) {
                Context p = ctx.attach();
                try { r.run(); } finally { ctx.detach(p); }
            }
            @Override public void onMessage(ReqT message) { run(() -> super.onMessage(message)); }
            @Override public void onHalfClose() { run(super::onHalfClose); }
            @Override public void onReady() { run(super::onReady); }
            @Override public void onCancel() { try { run(super::onCancel); } finally { ctx.cancel(null); } }
            @Override public void onComplete() { try { run(super::onComplete); } finally { ctx.cancel(null); } }
        };
    }
}
