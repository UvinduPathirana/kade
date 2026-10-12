package lk.kade.template;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.google.rpc.ErrorInfo;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.protobuf.StatusProto;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import lk.kade.template.v1.CreateNoteRequest;
import lk.kade.template.v1.CreateNoteResponse;
import lk.kade.template.v1.GetNoteRequest;
import lk.kade.template.v1.Note;
import lk.kade.template.v1.NoteCreated;
import org.junit.jupiter.api.Test;

class NoteGrpcIT extends IntegrationTestBase {

    @Test
    void createNoteWritesNoteAndOutboxRowAtomically() throws Exception {
        String currency = uniqueCurrency();
        Note note = stub("user-1").createNote(CreateNoteRequest.newBuilder()
                .setText("  hello  ").setAmount(money(115_000, currency)).build()).getNote();

        assertThat(note.getText()).isEqualTo("hello");
        assertThat(UUID.fromString(note.getId()).version()).isEqualTo(7);
        assertThat(stub("user-1").getNote(GetNoteRequest.newBuilder().setId(note.getId()).build()).getNote())
                .isEqualTo(note);

        var row = jdbc.sql("SELECT aggregatetype, aggregateid, type, payload, traceparent FROM outbox WHERE aggregateid = :id")
                .param("id", note.getId())
                .query((rs, n) -> new Object[] {rs.getString(1), rs.getString(2), rs.getString(3), rs.getBytes(4), rs.getString(5)})
                .single();
        assertThat(row[0]).isEqualTo("note");
        assertThat(row[2]).isEqualTo("kade.template.v1.NoteCreated");
        NoteCreated event = NoteCreated.parseFrom((byte[]) row[3]);
        assertThat(event.getNoteId()).isEqualTo(note.getId());
        assertThat(event.getAmount()).isEqualTo(money(115_000, currency));
        assertThat((String) row[4]).as("traceparent").matches("00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]");
    }

    @Test
    void sameIdempotencyKeyReturnsTheFirstResult() {
        String key = UUID.randomUUID().toString();
        CreateNoteRequest req = CreateNoteRequest.newBuilder()
                .setText("pay once").setAmount(money(500, "LKR")).setIdempotencyKey(key).build();

        Note first = stub("user-2").createNote(req).getNote();
        Note retry = stub("user-2").createNote(req).getNote();

        assertThat(retry).isEqualTo(first);
        assertThat(countOutbox(first.getId())).isEqualTo(1);
    }

    @Test
    void concurrentRetriesWithOneKeyCreateExactlyOneNote() throws Exception {
        String key = UUID.randomUUID().toString();
        CreateNoteRequest req = CreateNoteRequest.newBuilder()
                .setText("race").setAmount(money(700, "LKR")).setIdempotencyKey(key).build();
        List<Callable<CreateNoteResponse>> calls = IntStream.range(0, 8)
                .<Callable<CreateNoteResponse>>mapToObj(i -> () -> stub("user-3").createNote(req)).toList();

        Set<String> ids;
        try (ExecutorService pool = Executors.newFixedThreadPool(8)) {
            List<Future<CreateNoteResponse>> results = pool.invokeAll(calls);
            ids = results.stream().map(f -> {
                try { return f.get().getNote().getId(); } catch (Exception e) { throw new RuntimeException(e); }
            }).collect(Collectors.toSet());
        }
        assertThat(ids).hasSize(1);
        assertThat(countOutbox(ids.iterator().next())).isEqualTo(1);
    }

    @Test
    void keyReusedWithDifferentRequestIsRejected() {
        String key = UUID.randomUUID().toString();
        stub("user-4").createNote(CreateNoteRequest.newBuilder()
                .setText("a").setAmount(money(1, "LKR")).setIdempotencyKey(key).build());

        assertThatThrownBy(() -> stub("user-4").createNote(CreateNoteRequest.newBuilder()
                .setText("b").setAmount(money(1, "LKR")).setIdempotencyKey(key).build()))
                .satisfies(e -> assertStatus(e, Status.Code.FAILED_PRECONDITION, "IDEMPOTENCY_KEY_REUSED"));
    }

    @Test
    void keysAreScopedPerCaller() {
        String key = UUID.randomUUID().toString();
        CreateNoteRequest req = CreateNoteRequest.newBuilder()
                .setText("mine").setAmount(money(1, "LKR")).setIdempotencyKey(key).build();
        assertThat(stub("user-5a").createNote(req).getNote().getId())
                .isNotEqualTo(stub("user-5b").createNote(req).getNote().getId());
    }

    @Test
    void validationAndAuthErrorsCarryReasons() {
        assertThatThrownBy(() -> stub(null).createNote(CreateNoteRequest.newBuilder()
                .setText("x").setAmount(money(1, "LKR")).build()))
                .satisfies(e -> assertStatus(e, Status.Code.UNAUTHENTICATED, "UNAUTHENTICATED"));
        assertThatThrownBy(() -> stub("u").createNote(CreateNoteRequest.newBuilder()
                .setText("x").setAmount(money(-1, "LKR")).build()))
                .satisfies(e -> assertStatus(e, Status.Code.INVALID_ARGUMENT, "NOTE_AMOUNT_INVALID"));
        assertThatThrownBy(() -> stub("u").createNote(CreateNoteRequest.newBuilder()
                .setText("x").setAmount(money(1, "")).build()))
                .satisfies(e -> assertStatus(e, Status.Code.INVALID_ARGUMENT, "NOTE_AMOUNT_INVALID"));
        assertThatThrownBy(() -> stub("u").getNote(GetNoteRequest.newBuilder().setId(UUID.randomUUID().toString()).build()))
                .satisfies(e -> assertStatus(e, Status.Code.NOT_FOUND, "NOTE_NOT_FOUND"));
    }

    private long countOutbox(String aggregateId) {
        return jdbc.sql("SELECT count(*) FROM outbox WHERE aggregateid = :id").param("id", aggregateId)
                .query(Long.class).single();
    }

    static void assertStatus(Throwable e, Status.Code code, String reason) {
        assertThat(e).isInstanceOf(StatusRuntimeException.class);
        assertThat(Status.fromThrowable(e).getCode()).isEqualTo(code);
        try {
            ErrorInfo info = StatusProto.fromThrowable(e).getDetails(0).unpack(ErrorInfo.class);
            assertThat(info.getReason()).isEqualTo(reason);
            assertThat(info.getDomain()).isEqualTo("template-java-it");
        } catch (com.google.protobuf.InvalidProtocolBufferException ex) {
            throw new AssertionError(ex);
        }
    }
}
