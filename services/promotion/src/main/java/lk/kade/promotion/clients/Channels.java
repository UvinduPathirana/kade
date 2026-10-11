package lk.kade.promotion.clients;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.micrometer.core.instrument.binder.grpc.ObservationGrpcClientInterceptor;
import io.micrometer.observation.ObservationRegistry;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;

/**
 * Plaintext channels to other Kadé services, traced through Micrometer (traceparent goes out in metadata).
 * Identity metadata is deliberately not forwarded: promotion calls as an internal service.
 */
@Component
public class Channels implements DisposableBean {

    private final ObservationRegistry observations;
    private final List<ManagedChannel> open = new CopyOnWriteArrayList<>();

    public Channels(ObservationRegistry observations) {
        this.observations = observations;
    }

    public ManagedChannel open(String target) {
        ManagedChannel channel = ManagedChannelBuilder.forTarget(target)
                .usePlaintext()
                .intercept(new ObservationGrpcClientInterceptor(observations))
                .build();
        open.add(channel);
        return channel;
    }

    @Override
    public void destroy() throws InterruptedException {
        for (ManagedChannel c : open) {
            c.shutdown();
        }
        for (ManagedChannel c : open) {
            c.awaitTermination(2, TimeUnit.SECONDS);
        }
    }
}
