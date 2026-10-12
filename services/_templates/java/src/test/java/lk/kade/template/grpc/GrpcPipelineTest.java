package lk.kade.template.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.google.rpc.ErrorInfo;
import io.grpc.Deadline;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerInterceptors;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.protobuf.StatusProto;
import io.grpc.stub.MetadataUtils;
import io.grpc.stub.StreamObserver;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import lk.kade.template.config.KadeProperties;
import lk.kade.template.error.ErrorReasons;
import lk.kade.template.error.ServiceException;
import lk.kade.template.v1.GetNoteRequest;
import lk.kade.template.v1.GetNoteResponse;
import lk.kade.template.v1.TemplateServiceGrpc;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.grpc.server.exception.GrpcExceptionHandlerInterceptor;

/** Identity, deadline and error interceptors wired the way Spring gRPC wires them, on an in-process server. */
class GrpcPipelineTest {

    private final AtomicReference<Caller> seenCaller = new AtomicReference<>();
    private final AtomicReference<Deadline> seenDeadline = new AtomicReference<>();
    private Server server;
    private ManagedChannel channel;

    @BeforeEach
    void start() throws Exception {
        KadeProperties props = new KadeProperties("svc", "",
                new KadeProperties.Grpc(Duration.ofSeconds(2), Duration.ofSeconds(10)),
                new KadeProperties.Kafka(5, Duration.ofMillis(200), Duration.ofSeconds(5), Duration.ofSeconds(3)));
        var service = new TemplateServiceGrpc.TemplateServiceImplBase() {
            @Override
            public void getNote(GetNoteRequest request, StreamObserver<GetNoteResponse> response) {
                seenCaller.set(Caller.current());
                seenDeadline.set(io.grpc.Context.current().getDeadline());
                switch (request.getId()) {
                    case "missing" -> throw ServiceException.notFound("NOTE_NOT_FOUND", "nope");
                    case "boom" -> throw new IllegalStateException("secret internals");
                    case "admin" -> Caller.current().requireAnyRole("admin");
                    default -> { }
                }
                response.onNext(GetNoteResponse.getDefaultInstance());
                response.onCompleted();
            }
        };
        String name = InProcessServerBuilder.generateName();
        // Order as in Spring gRPC: last added runs first. Exception handler outermost, like the auto-configuration.
        server = InProcessServerBuilder.forName(name).directExecutor()
                .addService(ServerInterceptors.intercept(service,
                        new IdentityInterceptor(), new DeadlineInterceptor(props),
                        new GrpcExceptionHandlerInterceptor(new GrpcErrorHandler(props))))
                .build().start();
        channel = InProcessChannelBuilder.forName(name).directExecutor().build();
    }

    @AfterEach
    void stop() throws Exception {
        channel.shutdownNow();
        server.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
    }

    private TemplateServiceGrpc.TemplateServiceBlockingStub stub(String user, String roles) {
        Metadata md = new Metadata();
        if (user != null) md.put(IdentityInterceptor.USER_ID, user);
        if (roles != null) md.put(IdentityInterceptor.ROLES, roles);
        return TemplateServiceGrpc.newBlockingStub(channel).withInterceptors(MetadataUtils.newAttachHeadersInterceptor(md));
    }

    @Test
    void readsIdentityMetadata() {
        stub("u-1", "customer, ops").getNote(GetNoteRequest.newBuilder().setId("ok").build());
        assertThat(seenCaller.get()).isEqualTo(new Caller("u-1", Set.of("customer", "ops"), ""));
    }

    @Test
    void appliesDefaultDeadlineAndClampsLongOnes() {
        stub("u", null).getNote(GetNoteRequest.newBuilder().setId("ok").build());
        assertThat(seenDeadline.get().timeRemaining(TimeUnit.MILLISECONDS)).isBetween(1_000L, 2_000L);

        stub("u", null).withDeadlineAfter(60, TimeUnit.SECONDS).getNote(GetNoteRequest.newBuilder().setId("ok").build());
        assertThat(seenDeadline.get().timeRemaining(TimeUnit.MILLISECONDS)).isBetween(9_000L, 10_000L);
    }

    @Test
    void mapsServiceExceptionToStatusWithErrorInfo() {
        assertThatThrownBy(() -> stub("u", null).getNote(GetNoteRequest.newBuilder().setId("missing").build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class, e -> {
                    assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND);
                    assertThat(errorInfo(e).getReason()).isEqualTo("NOTE_NOT_FOUND");
                    assertThat(errorInfo(e).getDomain()).isEqualTo("svc");
                });
    }

    @Test
    void hidesUnexpectedErrors() {
        assertThatThrownBy(() -> stub("u", null).getNote(GetNoteRequest.newBuilder().setId("boom").build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class, e -> {
                    assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INTERNAL);
                    assertThat(e.getStatus().getDescription()).doesNotContain("secret");
                    assertThat(errorInfo(e).getReason()).isEqualTo(ErrorReasons.INTERNAL);
                });
    }

    @Test
    void enforcesRoles() {
        assertThatThrownBy(() -> stub("u", "customer").getNote(GetNoteRequest.newBuilder().setId("admin").build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class, e ->
                        assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.PERMISSION_DENIED));
        stub("u", "admin").getNote(GetNoteRequest.newBuilder().setId("admin").build());
    }

    static ErrorInfo errorInfo(StatusRuntimeException e) {
        try {
            return StatusProto.fromThrowable(e).getDetails(0).unpack(ErrorInfo.class);
        } catch (Exception ex) {
            throw new AssertionError(ex);
        }
    }
}
