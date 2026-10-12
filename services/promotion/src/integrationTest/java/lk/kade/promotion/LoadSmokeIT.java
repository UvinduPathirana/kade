package lk.kade.promotion;

import static org.assertj.core.api.Assertions.assertThat;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import lk.kade.template.v1.CreateNoteRequest;
import lk.kade.template.v1.GetNoteRequest;
import lk.kade.template.v1.TemplateServiceGrpc;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Opt-in smoke load against a RUNNING container (not the in-test app), used to measure memory under load:
 *   LOAD_TARGET=promotion:50106 LOAD_SECONDS=60 LOAD_CLIENTS=8 ./gradlew integrationTest --tests '*LoadSmokeIT'
 * Half the calls are idempotent CreateNote (each followed by a retry with the same key), half GetNote.
 * No Spring context: it only needs the generated stubs.
 */
@EnabledIfEnvironmentVariable(named = "LOAD_TARGET", matches = ".+")
class LoadSmokeIT {

    @Test
    void sustainsMixedLoad() throws Exception {
        String target = System.getenv("LOAD_TARGET");
        Duration duration = Duration.ofSeconds(Long.parseLong(System.getenv().getOrDefault("LOAD_SECONDS", "30")));
        int clients = Integer.parseInt(System.getenv().getOrDefault("LOAD_CLIENTS", "8"));
        ManagedChannel channel = ManagedChannelBuilder.forTarget(target).usePlaintext().build();
        Metadata md = new Metadata();
        md.put(Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER), "load");
        var stub = TemplateServiceGrpc.newBlockingStub(channel).withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md));
        AtomicLong ok = new AtomicLong(), failed = new AtomicLong();
        long end = System.nanoTime() + duration.toNanos();
        try (ExecutorService pool = Executors.newFixedThreadPool(clients)) {
            List<Future<?>> workers = new ArrayList<>();
            for (int c = 0; c < clients; c++) {
                workers.add(pool.submit(() -> {
                    while (System.nanoTime() < end) {
                        try {
                            var req = CreateNoteRequest.newBuilder().setText("load").setIdempotencyKey(UUID.randomUUID().toString())
                                    .setAmount(lk.kade.common.v1.Money.newBuilder().setAmountMinor(100).setCurrency("LKR")).build();
                            var s = stub.withDeadlineAfter(2, TimeUnit.SECONDS);
                            String id = s.createNote(req).getNote().getId();
                            s.createNote(req); // retry: served from idempotency_keys
                            s.getNote(GetNoteRequest.newBuilder().setId(id).build());
                            s.getNote(GetNoteRequest.newBuilder().setId(id).build());
                            ok.addAndGet(4);
                        } catch (RuntimeException e) {
                            failed.incrementAndGet();
                        }
                    }
                }));
            }
            for (Future<?> w : workers) w.get();
        } finally {
            channel.shutdownNow();
        }
        System.out.printf("LOAD %s: %d ok, %d failed in %ds = %.0f rpc/s%n",
                target, ok.get(), failed.get(), duration.toSeconds(), ok.get() / (double) duration.toSeconds());
        assertThat(failed.get()).isZero();
    }
}
