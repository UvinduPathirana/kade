package lk.kade.promotion.note;

import io.grpc.stub.StreamObserver;
import java.util.UUID;
import lk.kade.promotion.error.ServiceException;
import lk.kade.promotion.grpc.Caller;
import lk.kade.promotion.grpc.Deadlines;
import lk.kade.promotion.idempotency.IdempotencyService;
import lk.kade.promotion.money.Money;
import lk.kade.template.v1.CreateNoteRequest;
import lk.kade.template.v1.CreateNoteResponse;
import lk.kade.template.v1.GetNoteRequest;
import lk.kade.template.v1.GetNoteResponse;
import lk.kade.template.v1.TemplateServiceGrpc;
import org.springframework.stereotype.Service;

/**
 * gRPC adapter: validate and map the request, authorise from {@link Caller}, call the domain, map the response.
 * Exceptions propagate to {@link lk.kade.promotion.grpc.GrpcErrorHandler}; never call {@code onError} by hand.
 * Spring gRPC registers every {@code BindableService} bean on the gRPC port.
 */
@Service
public class NoteGrpcService extends TemplateServiceGrpc.TemplateServiceImplBase {

    static final String CREATE_NOTE = TemplateServiceGrpc.getCreateNoteMethod().getFullMethodName();

    private final NoteService notes;
    private final IdempotencyService idempotency;

    public NoteGrpcService(NoteService notes, IdempotencyService idempotency) {
        this.notes = notes;
        this.idempotency = idempotency;
    }

    @Override
    public void createNote(CreateNoteRequest request, StreamObserver<CreateNoteResponse> response) {
        Caller caller = Caller.current().requireAuthenticated();
        Money amount = parseAmount(request);
        Deadlines.check();
        CreateNoteResponse result;
        if (request.getIdempotencyKey().isEmpty()) {
            result = create(request, amount, caller);
        } else {
            // One transaction around the key claim, the note, the outbox row and the stored response.
            result = idempotency.execute(
                    CREATE_NOTE, caller.userId(), request.getIdempotencyKey(),
                    request.toBuilder().clearIdempotencyKey().build(),
                    CreateNoteResponse.parser(),
                    () -> create(request, amount, caller));
        }
        response.onNext(result);
        response.onCompleted();
    }

    private CreateNoteResponse create(CreateNoteRequest request, Money amount, Caller caller) {
        Note note = notes.create(request.getText(), amount, caller.userId());
        return CreateNoteResponse.newBuilder().setNote(note.toProto()).build();
    }

    @Override
    public void getNote(GetNoteRequest request, StreamObserver<GetNoteResponse> response) {
        Caller.current().requireAuthenticated();
        Note note = notes.get(parseId(request.getId()));
        response.onNext(GetNoteResponse.newBuilder().setNote(note.toProto()).build());
        response.onCompleted();
    }

    private static Money parseAmount(CreateNoteRequest request) {
        if (!request.hasAmount()) {
            throw ServiceException.invalidArgument(NoteService.NOTE_AMOUNT_INVALID, "amount is required");
        }
        try {
            return Money.fromProto(request.getAmount());
        } catch (IllegalArgumentException e) {
            throw ServiceException.invalidArgument(NoteService.NOTE_AMOUNT_INVALID, e.getMessage());
        }
    }

    private static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            throw ServiceException.invalidArgument("NOTE_ID_INVALID", "id must be a UUID");
        }
    }
}
