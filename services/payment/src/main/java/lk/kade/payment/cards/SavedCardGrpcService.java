package lk.kade.payment.cards;

import io.grpc.stub.StreamObserver;
import lk.kade.payment.access.Access;
import lk.kade.payment.grpc.Caller;
import lk.kade.payment.v1.AddSavedCardRequest;
import lk.kade.payment.v1.AddSavedCardResponse;
import lk.kade.payment.v1.CreateCardSetupSessionRequest;
import lk.kade.payment.v1.CreateCardSetupSessionResponse;
import lk.kade.payment.v1.ListSavedCardsRequest;
import lk.kade.payment.v1.ListSavedCardsResponse;
import lk.kade.payment.v1.RemoveSavedCardRequest;
import lk.kade.payment.v1.RemoveSavedCardResponse;
import lk.kade.payment.v1.SavedCardServiceGrpc;
import org.springframework.stereotype.Service;

/** kade.payment.v1.SavedCardService. Customers manage their own cards; staff and services name the customer. */
@Service
public class SavedCardGrpcService extends SavedCardServiceGrpc.SavedCardServiceImplBase {

    private final SavedCardService cards;

    public SavedCardGrpcService(SavedCardService cards) {
        this.cards = cards;
    }

    @Override
    public void listSavedCards(ListSavedCardsRequest request, StreamObserver<ListSavedCardsResponse> response) {
        String customer = Access.customerFor(Caller.current(), request.getCustomerId());
        ListSavedCardsResponse.Builder out = ListSavedCardsResponse.newBuilder();
        cards.list(customer).forEach(c -> out.addCards(c.toProto()));
        response.onNext(out.build());
        response.onCompleted();
    }

    @Override
    public void createCardSetupSession(CreateCardSetupSessionRequest request,
                                       StreamObserver<CreateCardSetupSessionResponse> response) {
        String customer = Access.customerFor(Caller.current(), request.getCustomerId());
        response.onNext(cards.createSession(customer));
        response.onCompleted();
    }

    @Override
    public void addSavedCard(AddSavedCardRequest request, StreamObserver<AddSavedCardResponse> response) {
        String customer = Access.customerFor(Caller.current(), request.getCustomerId());
        SavedCard card = cards.add(customer, request);
        response.onNext(AddSavedCardResponse.newBuilder().setCard(card.toProto()).build());
        response.onCompleted();
    }

    @Override
    public void removeSavedCard(RemoveSavedCardRequest request, StreamObserver<RemoveSavedCardResponse> response) {
        String customer = Access.customerFor(Caller.current(), request.getCustomerId());
        cards.remove(customer, request.getCardId());
        response.onNext(RemoveSavedCardResponse.getDefaultInstance());
        response.onCompleted();
    }
}
