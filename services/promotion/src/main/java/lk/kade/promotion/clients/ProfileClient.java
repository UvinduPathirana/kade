package lk.kade.promotion.clients;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import java.util.concurrent.TimeUnit;
import lk.kade.promotion.error.ServiceException;
import lk.kade.promotion.money.Money;
import lk.kade.profile.v1.ChangeCreditRequest;
import lk.kade.profile.v1.CreditReason;
import lk.kade.profile.v1.CreditServiceGrpc;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Adds Kadé credit through profile.CreditService/ChangeCredit. Idempotent on the key we pass, so a retried
 * Kafka handler or RPC never credits twice. PROFILE_MODE=stub only logs (for running promotion alone).
 */
@Component
public class ProfileClient {

    private static final Logger log = LoggerFactory.getLogger(ProfileClient.class);

    private final CreditServiceGrpc.CreditServiceBlockingStub stub;
    private final DependencyProperties deps;

    public ProfileClient(Channels channels, DependencyProperties deps) {
        this.deps = deps;
        this.stub = deps.profileStubbed() ? null : CreditServiceGrpc.newBlockingStub(channels.open(deps.profileGrpc()));
    }

    public void addCredit(String customerId, Money amount, CreditReason reason, String label, String orderId,
            String idempotencyKey) {
        if (stub == null) {
            log.info("PROFILE_MODE=stub: would credit {} to {} ({}, key {})", amount, customerId, reason, idempotencyKey);
            return;
        }
        try {
            stub.withDeadlineAfter(deps.deadline().toMillis(), TimeUnit.MILLISECONDS)
                    .changeCredit(ChangeCreditRequest.newBuilder()
                            .setCustomerId(customerId)
                            .setAmount(amount.toProto())
                            .setReason(reason)
                            .setLabel(label)
                            .setOrderId(orderId == null ? "" : orderId)
                            .setBy("Kadé")
                            .setIdempotencyKey(idempotencyKey)
                            .build());
        } catch (StatusRuntimeException e) {
            throw new ServiceException(e.getStatus().getCode() == Status.Code.UNAVAILABLE
                    ? Status.Code.UNAVAILABLE : Status.Code.INTERNAL,
                    "PROFILE_UNAVAILABLE", "profile ChangeCredit failed: " + e.getStatus());
        }
    }
}
