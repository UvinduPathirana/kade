package lk.kade.ledger.outbox;

import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import io.micrometer.tracing.propagation.Propagator;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Renders the current span as a W3C {@code traceparent} so the outbox can carry it into the Kafka header. */
@Component
public class TraceContext {

    private final Tracer tracer;
    private final Propagator propagator;

    public TraceContext(Tracer tracer, Propagator propagator) {
        this.tracer = tracer;
        this.propagator = propagator;
    }

    /** {@code 00-<trace-id>-<span-id>-<flags>}, or null when there is no current span. */
    public String currentTraceparent() {
        Span span = tracer.currentSpan();
        if (span == null) {
            return null;
        }
        Map<String, String> carrier = new HashMap<>();
        propagator.inject(span.context(), carrier, Map::put);
        return carrier.get("traceparent");
    }
}
