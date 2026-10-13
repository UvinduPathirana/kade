package lk.kade.payment.payments;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lk.kade.common.v1.PaymentMethod;
import lk.kade.common.v1.PaymentMethodKind;
import lk.kade.payment.cards.SavedCard;
import lk.kade.payment.cards.SavedCardRepository;
import lk.kade.payment.cards.SavedCardService;
import lk.kade.payment.db.OptimisticRetry;
import lk.kade.payment.error.ErrorReasons;
import lk.kade.payment.error.ServiceException;
import lk.kade.payment.money.Money;
import lk.kade.payment.outbox.OutboxWriter;
import lk.kade.payment.outbox.UuidV7;
import lk.kade.payment.psp.Psp;
import lk.kade.payment.psp.PspClient;
import lk.kade.payment.psp.PspUnavailableException;
import lk.kade.payment.v1.AuthorisePaymentRequest;
import lk.kade.payment.v1.Payment;
import lk.kade.payment.v1.PaymentAuthorisationAdjusted;
import lk.kade.payment.v1.PaymentAuthorised;
import lk.kade.payment.v1.PaymentCaptured;
import lk.kade.payment.v1.PaymentDeclined;
import lk.kade.payment.v1.PaymentPurpose;
import lk.kade.payment.v1.PaymentRefundFailed;
import lk.kade.payment.v1.PaymentRefunded;
import lk.kade.payment.v1.PaymentVoided;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The payment state machine (see payment_service.proto):
 * <pre>
 * Card:  PENDING ─psp→ AUTHORISED ─capture→ CAPTURED ─refund→ PARTIALLY_REFUNDED / REFUNDED
 *                 ├→ DECLINED      └ void → VOIDED
 *                 └→ FAILED (PSP unreachable after retries)
 * Cash:  CASH_DUE ─rider collects→ CAPTURED      CASH_DUE ─void→ VOIDED      (never refunded in cash)
 * </pre>
 * Every change is a read-decide-write on a versioned row plus an outbox event in the same transaction.
 */
@Service
public class PaymentService {

    public static final String AGGREGATE_TYPE = "payment"; // -> kade.payment.events

    public static final String PAYMENT_NOT_FOUND = "PAYMENT_NOT_FOUND";
    public static final String PAYMENT_AMOUNT_INVALID = "PAYMENT_AMOUNT_INVALID";
    public static final String PAYMENT_METHOD_INVALID = "PAYMENT_METHOD_INVALID";
    public static final String PAYMENT_METHOD_MISMATCH = "PAYMENT_METHOD_MISMATCH";
    public static final String PAYMENT_REFERENCE_REQUIRED = "PAYMENT_REFERENCE_REQUIRED";
    public static final String CURRENCY_MISMATCH = "CURRENCY_MISMATCH";
    public static final String PAYMENT_NOT_CAPTURABLE = "PAYMENT_NOT_CAPTURABLE";
    public static final String PAYMENT_NOT_COLLECTABLE = "PAYMENT_NOT_COLLECTABLE";
    public static final String PAYMENT_NOT_VOIDABLE = "PAYMENT_NOT_VOIDABLE";
    public static final String PAYMENT_ALREADY_CAPTURED = "PAYMENT_ALREADY_CAPTURED";
    public static final String PAYMENT_NOT_ADJUSTABLE = "PAYMENT_NOT_ADJUSTABLE";
    public static final String PAYMENT_NOT_REFUNDABLE = "PAYMENT_NOT_REFUNDABLE";
    public static final String CASH_NOT_REFUNDABLE = "CASH_NOT_REFUNDABLE";
    public static final String REFUND_AMOUNT_INVALID = "REFUND_AMOUNT_INVALID";
    public static final String REFUND_EXCEEDS_CAPTURED = "REFUND_EXCEEDS_CAPTURED";
    public static final String ADJUSTMENT_DECLINED = "ADJUSTMENT_DECLINED";

    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);
    private static final String RETRY_HINT = "Pay with another card or with cash instead.";

    private final PaymentRepository payments;
    private final SavedCardService savedCards;
    private final SavedCardRepository cardRows;
    private final PspClient psp;
    private final OutboxWriter outbox;
    private final Clock clock;
    private final TransactionTemplate tx;

    public PaymentService(PaymentRepository payments, SavedCardService savedCards, SavedCardRepository cardRows,
                          PspClient psp, OutboxWriter outbox, Clock clock, TransactionTemplate tx) {
        this.payments = payments;
        this.savedCards = savedCards;
        this.cardRows = cardRows;
        this.psp = psp;
        this.outbox = outbox;
        this.clock = clock;
        this.tx = tx;
    }

    // =========================================================================================================
    // Authorise: two short transactions around the PSP call (never hold a DB transaction across the network)
    // =========================================================================================================

    /**
     * Saga step 3. Idempotent on {@code (principal, idempotency_key)}: a retry returns the payment's <b>current</b>
     * state, so a PENDING authorisation that a webhook resolved later reads as AUTHORISED/DECLINED on the retry.
     * A row left PENDING by a crash between the two transactions is resumed by the retry (the PSP call is
     * idempotent on the payment id).
     */
    public Payment authorise(AuthorisePaymentRequest req, String principal) {
        Money amount = validateAuthorise(req);
        byte[] hash = sha256(req.toBuilder().clearIdempotencyKey().build().toByteArray());
        String key = req.getIdempotencyKey().isEmpty() ? "auto:" + UuidV7.next() : req.getIdempotencyKey();

        Optional<PaymentRepository.Keyed> existing = payments.findByAuthoriseKey(principal, key);
        if (existing.isPresent()) {
            return replay(existing.get(), hash);
        }
        PaymentRow created = tx.execute(s -> createIntent(req, amount, principal, key, hash));
        if (created == null) { // lost the race for the key to a concurrent duplicate
            return replay(payments.findByAuthoriseKey(principal, key).orElseThrow(), hash);
        }
        return created.is("PENDING") ? resolveWithPsp(created.id) : toProto(created);
    }

    private Payment replay(PaymentRepository.Keyed keyed, byte[] hash) {
        if (!Arrays.equals(keyed.requestHash(), hash)) {
            throw ServiceException.failedPrecondition(ErrorReasons.IDEMPOTENCY_KEY_REUSED,
                    "idempotency key was already used with a different request");
        }
        PaymentRow p = keyed.payment();
        return p.is("PENDING") && p.pspReference.isEmpty() ? resolveWithPsp(p.id) : toProto(p);
    }

    private PaymentRow createIntent(AuthorisePaymentRequest req, Money amount, String principal, String key,
                                    byte[] hash) {
        Instant now = now();
        PaymentRow p = new PaymentRow();
        p.id = UuidV7.next();
        p.purpose = Protos.shortName(req.getPurpose(), "PAYMENT_PURPOSE_");
        p.referenceId = req.getReferenceId();
        p.referenceLabel = req.getReferenceLabel();
        p.customerId = req.getCustomerId();
        p.currency = amount.currency();
        p.requestedMinor = amount.amountMinor();
        p.createdAt = now;
        PaymentMethod method = req.getMethod();
        if (method.getKind() == PaymentMethodKind.PAYMENT_METHOD_KIND_CASH) {
            p.methodKind = "CASH";
            p.status = "CASH_DUE";
            p.authorisedMinor = amount.amountMinor();
            p.authorisedAt = now;
            if (method.hasCashPayingWith() && method.getCashPayingWith().getAmountMinor() > 0) {
                p.cashPayingWithMinor = method.getCashPayingWith().getAmountMinor();
            }
        } else {
            SavedCard card = resolveCard(req.getCustomerId(), method);
            p.methodKind = "CARD";
            p.status = "PENDING";
            p.cardId = card.id();
            p.cardBrand = card.brand();
            p.cardLast4 = card.last4();
        }
        if (!payments.insert(p, principal, key, hash)) {
            return null;
        }
        if (p.isCash()) {
            outbox.append(AGGREGATE_TYPE, p.id.toString(), authorisedEvent(p));
        }
        return p;
    }

    private SavedCard resolveCard(String customerId, PaymentMethod method) {
        Optional<SavedCard> card = savedCards.findLive(customerId, method.getCardId());
        if (card.isEmpty() && !method.getCardLast4().isEmpty()) {
            card = savedCards.findLiveByDisplay(customerId, method.getCardBrand(), method.getCardLast4());
        }
        return card.orElseThrow(() -> ServiceException.failedPrecondition(SavedCardService.CARD_NOT_FOUND,
                "Choose a saved card, or add one in your account."));
    }

    /** Asks the PSP (outside any transaction), then records the outcome on the still-PENDING row. */
    private Payment resolveWithPsp(UUID id) {
        PaymentRow p = payments.find(id).orElseThrow();
        if (!p.is("PENDING")) {
            return toProto(p);
        }
        SavedCard card = cardRows.find(p.cardId).orElseThrow();
        Psp.Authorisation result = null;
        String failure = null;
        try {
            result = psp.authorise(p.id.toString(), card.forPsp(), p.requested());
        } catch (PspUnavailableException e) {
            failure = "processing_error";
        } catch (ServiceException e) {
            if (!PspClient.PSP_UNAVAILABLE.equals(e.reason())) throw e;
            failure = "psp_unavailable";
        }
        Psp.Authorisation outcome = result;
        String error = failure;
        PaymentRow done = OptimisticRetry.run(3, () -> tx.execute(s -> {
            PaymentRow cur = payments.find(id).orElseThrow();
            if (!cur.is("PENDING")) {
                return cur; // resolved meanwhile (webhook or a concurrent retry)
            }
            if (error != null) {
                cur.status = "FAILED";
                cur.declineCode = error;
                cur.declineMessage = "We couldn't reach your bank, so nothing was charged. Please try again in a minute.";
                payments.update(cur);
                log.warn("payment {} FAILED: psp {}", cur.id, error);
                return cur;
            }
            switch (outcome.outcome()) {
                case APPROVED -> markAuthorised(cur, outcome.pspReference());
                case DECLINED -> markDeclined(cur, outcome.pspReference(), outcome.declineCode());
                case PENDING -> {
                    if (cur.pspReference.isEmpty()) {
                        cur.pspReference = outcome.pspReference();
                        payments.update(cur); // waiting for the PSP's webhook (3-D Secure)
                    }
                }
            }
            return cur;
        }));
        return toProto(done);
    }

    private void markAuthorised(PaymentRow p, String pspReference) {
        p.status = "AUTHORISED";
        p.authorisedMinor = p.requestedMinor;
        p.authorisedAt = now();
        p.pspReference = pspReference;
        payments.update(p);
        outbox.append(AGGREGATE_TYPE, p.id.toString(), authorisedEvent(p));
    }

    private void markDeclined(PaymentRow p, String pspReference, String code) {
        p.status = "DECLINED";
        p.pspReference = pspReference;
        p.declineCode = code;
        p.declineMessage = declineMessage(code, Protos.brandLabel(p.cardBrand) + " ending " + p.cardLast4);
        payments.update(p);
        outbox.append(AGGREGATE_TYPE, p.id.toString(), PaymentDeclined.newBuilder()
                .setPaymentId(p.id.toString())
                .setPurpose(p.purposeProto())
                .setReferenceId(p.referenceId)
                .setCustomerId(p.customerId)
                .setAmount(p.requested().toProto())
                .setDeclineCode(code)
                .setCardLast4(p.cardLast4)
                .setOccurredAt(Protos.ts(now()))
                .build());
    }

    static String declineMessage(String code, String card) {
        return switch (code) {
            case "insufficient_funds" -> "Your bank declined " + card + " (not enough funds), so nothing was charged. " + RETRY_HINT;
            case "expired_card" -> card + " has expired, so nothing was charged. " + RETRY_HINT;
            case "incorrect_cvc" -> "Your bank couldn't verify " + card + ", so nothing was charged. " + RETRY_HINT;
            case "authentication_failed" -> card + " wasn't verified by your bank, so nothing was charged. " + RETRY_HINT;
            default -> "Your bank declined " + card + ", so nothing was charged. " + RETRY_HINT;
        };
    }

    /**
     * A PSP webhook resolved a PENDING authorisation. Runs in the webhook's transaction; the row is locked
     * ({@code FOR UPDATE}) so it can't race the synchronous path.
     */
    @Transactional
    public Optional<PaymentRow> applyAuthorisationOutcome(UUID paymentId, String pspReference, boolean approved,
                                                          String declineCode) {
        Optional<PaymentRow> found = payments.findForUpdate(paymentId);
        found.filter(p -> p.is("PENDING")).ifPresent(p -> {
            if (approved) {
                markAuthorised(p, pspReference);
            } else {
                markDeclined(p, pspReference, declineCode.isEmpty() ? "card_declined" : declineCode);
            }
        });
        return found;
    }

    // =========================================================================================================
    // Mutations on an existing payment (each runs in the caller's transaction; wrap in OptimisticRetry)
    // =========================================================================================================

    /** Card capture (at pickup). Already captured → returned as is. */
    @Transactional
    public PaymentRow capture(String paymentId, Optional<Money> amount) {
        PaymentRow p = load(paymentId);
        if (p.isCash()) {
            throw ServiceException.failedPrecondition(PAYMENT_METHOD_MISMATCH,
                    "cash payments are captured when the rider collects them");
        }
        if (p.is("CAPTURED") || p.is("PARTIALLY_REFUNDED") || p.is("REFUNDED")) {
            return p;
        }
        if (!p.is("AUTHORISED")) {
            throw ServiceException.failedPrecondition(PAYMENT_NOT_CAPTURABLE, "payment is " + p.status);
        }
        Money take = amount.orElse(p.authorised());
        requireSameCurrency(p, take);
        if (!take.isPositive() || take.isGreaterThan(p.authorised())) {
            throw ServiceException.invalidArgument(PAYMENT_AMOUNT_INVALID,
                    "capture must be between 0 and the authorised amount");
        }
        psp.capture(p.pspReference, take);
        p.status = "CAPTURED";
        p.capturedMinor = take.amountMinor();
        p.capturedAt = now();
        payments.update(p);
        outbox.append(AGGREGATE_TYPE, p.id.toString(), capturedEvent(p));
        return p;
    }

    /**
     * Cash taken at the door. {@code clamp}: from DeliveryCompleted, where the rider may report the note handed
     * over; the payment records at most what was due.
     */
    @Transactional
    public PaymentRow recordCash(String paymentId, Optional<Money> amount, String riderId, String deliveryId,
                                 boolean clamp) {
        PaymentRow p = load(paymentId);
        if (!p.isCash()) {
            throw ServiceException.failedPrecondition(PAYMENT_METHOD_MISMATCH, "card payments are captured, not collected");
        }
        if (p.is("CAPTURED")) {
            return p;
        }
        if (!p.is("CASH_DUE")) {
            throw ServiceException.failedPrecondition(PAYMENT_NOT_COLLECTABLE, "payment is " + p.status);
        }
        Money collected = amount.filter(Money::isPositive).orElse(p.authorised());
        requireSameCurrency(p, collected);
        if (collected.isGreaterThan(p.authorised())) {
            if (!clamp) {
                throw ServiceException.invalidArgument(PAYMENT_AMOUNT_INVALID,
                        "collected more than was due; record the amount due, not the note handed over");
            }
            collected = p.authorised();
        }
        p.status = "CAPTURED";
        p.capturedMinor = collected.amountMinor();
        p.capturedAt = now();
        p.collectedByRiderId = riderId;
        p.deliveryId = deliveryId;
        payments.update(p);
        outbox.append(AGGREGATE_TYPE, p.id.toString(), capturedEvent(p));
        return p;
    }

    /** DeliveryCompleted → the cash payment for that order is collected. No cash payment → nothing to do. */
    @Transactional
    public Optional<PaymentRow> collectCashForOrder(String orderId, String riderId, String deliveryId, Money cash) {
        Optional<PaymentRow> due = payments.findByReference(orderId).stream()
                .filter(p -> p.isCash() && p.is("CASH_DUE"))
                .findFirst();
        return due.map(p -> recordCash(p.id.toString(), Optional.of(cash), riderId, deliveryId, true));
    }

    /** Releases a hold / cancels a cash intent. Already voided → returned as is. */
    @Transactional
    public PaymentRow voidPayment(String paymentId, String reason) {
        PaymentRow p = load(paymentId);
        switch (p.status) {
            case "VOIDED" -> {
                return p;
            }
            case "AUTHORISED", "PENDING" -> {
                if (!p.pspReference.isEmpty()) {
                    psp.voidAuthorisation(p.pspReference);
                }
            }
            case "CASH_DUE" -> { }
            case "CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED" -> throw ServiceException.failedPrecondition(
                    PAYMENT_ALREADY_CAPTURED, "payment was already captured; refund it instead");
            default -> throw ServiceException.failedPrecondition(PAYMENT_NOT_VOIDABLE, "payment is " + p.status);
        }
        p.status = "VOIDED";
        p.voidedAt = now();
        payments.update(p);
        outbox.append(AGGREGATE_TYPE, p.id.toString(), PaymentVoided.newBuilder()
                .setPaymentId(p.id.toString())
                .setPurpose(p.purposeProto())
                .setReferenceId(p.referenceId)
                .setCustomerId(p.customerId)
                .setMethod(p.methodKindProto())
                .setAmount(p.authorised().toProto())
                .setReason(reason)
                .setOccurredAt(Protos.ts(p.voidedAt))
                .build());
        return p;
    }

    /** Tip changed after placing: move the hold to the new amount. */
    @Transactional
    public PaymentRow adjust(String paymentId, Money newAmount) {
        PaymentRow p = load(paymentId);
        if (p.isCash()) {
            // Cash: nothing is held; the rider collects the new total.
            requireSameCurrency(p, newAmount);
        } else if (!p.is("AUTHORISED")) {
            throw ServiceException.failedPrecondition(PAYMENT_NOT_ADJUSTABLE, "payment is " + p.status);
        }
        if (p.isCash() && !p.is("CASH_DUE")) {
            throw ServiceException.failedPrecondition(PAYMENT_NOT_ADJUSTABLE, "payment is " + p.status);
        }
        requireSameCurrency(p, newAmount);
        if (!newAmount.isPositive()) {
            throw ServiceException.invalidArgument(PAYMENT_AMOUNT_INVALID, "amount must be positive");
        }
        if (newAmount.amountMinor() == p.authorisedMinor) {
            return p;
        }
        if (!p.isCash()) {
            SavedCard card = cardRows.find(p.cardId).orElseThrow();
            Psp.Authorisation result = psp.adjust(p.pspReference, card.forPsp(), newAmount);
            if (result.outcome() != Psp.Outcome.APPROVED) {
                throw ServiceException.failedPrecondition(ADJUSTMENT_DECLINED,
                        declineMessage(result.declineCode(), card.label()));
            }
        }
        Money previous = p.authorised();
        p.requestedMinor = newAmount.amountMinor();
        p.authorisedMinor = newAmount.amountMinor();
        payments.update(p);
        outbox.append(AGGREGATE_TYPE, p.id.toString(), PaymentAuthorisationAdjusted.newBuilder()
                .setPaymentId(p.id.toString())
                .setReferenceId(p.referenceId)
                .setAmount(newAmount.toProto())
                .setPreviousAmount(previous.toProto())
                .setOccurredAt(Protos.ts(now()))
                .build());
        return p;
    }

    public record Refunded(PaymentRow payment, RefundRow refund) {}

    /** Card refund, partial or full, of a captured payment. */
    @Transactional
    public Refunded refund(String paymentId, Money amount, String reason, String orderRefundId) {
        PaymentRow p = load(paymentId);
        if (p.isCash()) {
            throw ServiceException.failedPrecondition(CASH_NOT_REFUNDABLE,
                    "cash orders are refunded as Kadé credit, not in cash");
        }
        if (!p.is("CAPTURED") && !p.is("PARTIALLY_REFUNDED") && !p.is("REFUNDED")) {
            throw ServiceException.failedPrecondition(PAYMENT_NOT_REFUNDABLE, "payment is " + p.status);
        }
        requireSameCurrency(p, amount);
        if (!amount.isPositive()) {
            throw ServiceException.invalidArgument(REFUND_AMOUNT_INVALID, "refund at least Rs 1");
        }
        Money left = p.captured().minus(p.refunded());
        if (amount.isGreaterThan(left)) {
            throw ServiceException.failedPrecondition(REFUND_EXCEEDS_CAPTURED,
                    "only " + left.amountMinor() + " minor units are left to refund");
        }
        Instant now = now();
        UUID refundId = UuidV7.next();
        String pspRef = psp.refund(p.pspReference, refundId.toString(), amount);
        RefundRow refund = new RefundRow(refundId, p.id, amount, reason, orderRefundId, "SUCCEEDED", pspRef, now, now);
        payments.insertRefund(refund);
        p.refundedMinor = p.refunded().plus(amount).amountMinor();
        p.status = p.refundedMinor == p.capturedMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
        payments.update(p);
        outbox.append(AGGREGATE_TYPE, p.id.toString(), PaymentRefunded.newBuilder()
                .setPaymentId(p.id.toString())
                .setPurpose(p.purposeProto())
                .setReferenceId(p.referenceId)
                .setCustomerId(p.customerId)
                .setRefund(refund.toProto())
                .setRefundedTotal(p.refunded().toProto())
                .setOrderRefundId(orderRefundId)
                .setOccurredAt(Protos.ts(now))
                .build());
        return new Refunded(p, refund);
    }

    /**
     * A PSP webhook says a refund ultimately failed (asynchronous bank rejection): give the amount back to the
     * payment's refundable balance and tell ledger/order via PaymentRefundFailed.
     */
    @Transactional
    public boolean applyRefundFailure(UUID refundId, String error) {
        Optional<RefundRow> found = payments.findRefund(refundId);
        if (found.isEmpty() || "FAILED".equals(found.get().status())) {
            return false;
        }
        RefundRow r = found.get();
        PaymentRow p = payments.findForUpdate(r.paymentId()).orElseThrow();
        Instant now = now();
        payments.completeRefund(r.id(), "FAILED", now);
        p.refundedMinor = Math.max(0, p.refundedMinor - r.amount().amountMinor());
        p.status = p.refundedMinor == 0 ? "CAPTURED" : "PARTIALLY_REFUNDED";
        payments.update(p);
        RefundRow failed = new RefundRow(r.id(), r.paymentId(), r.amount(), r.reason(), r.orderRefundId(), "FAILED",
                r.pspReference(), r.createdAt(), now);
        outbox.append(AGGREGATE_TYPE, p.id.toString(), PaymentRefundFailed.newBuilder()
                .setPaymentId(p.id.toString())
                .setReferenceId(p.referenceId)
                .setRefund(failed.toProto())
                .setOrderRefundId(r.orderRefundId())
                .setError(error)
                .setOccurredAt(Protos.ts(now))
                .build());
        return true;
    }

    // =========================================================================================================
    // Reads
    // =========================================================================================================

    @Transactional(readOnly = true)
    public PaymentRow get(String paymentId) {
        return load(paymentId);
    }

    @Transactional(readOnly = true)
    public Payment toProto(PaymentRow p) {
        return p.toProto(payments.refunds(p.id));
    }

    public record Page(List<Payment> payments, int total) {}

    @Transactional(readOnly = true)
    public Page list(String referenceId, String customerId, int limit, int offset) {
        List<PaymentRow> rows = payments.list(referenceId, customerId, limit, offset);
        Map<UUID, List<RefundRow>> refunds = payments.refunds(rows.stream().map(r -> r.id).toList());
        return new Page(rows.stream().map(r -> r.toProto(refunds.getOrDefault(r.id, List.of()))).toList(),
                payments.count(referenceId, customerId));
    }

    // =========================================================================================================
    // Helpers
    // =========================================================================================================

    private PaymentRow load(String paymentId) {
        UUID id;
        try {
            id = UUID.fromString(paymentId);
        } catch (IllegalArgumentException e) {
            throw ServiceException.notFound(PAYMENT_NOT_FOUND, "payment " + paymentId + " not found");
        }
        return payments.find(id)
                .orElseThrow(() -> ServiceException.notFound(PAYMENT_NOT_FOUND, "payment " + paymentId + " not found"));
    }

    private static Money validateAuthorise(AuthorisePaymentRequest req) {
        if (req.getReferenceId().isBlank()) {
            throw ServiceException.invalidArgument(PAYMENT_REFERENCE_REQUIRED, "reference_id is required");
        }
        if (req.getCustomerId().isBlank()) {
            throw ServiceException.invalidArgument("CUSTOMER_ID_REQUIRED", "customer_id is required");
        }
        if (req.getPurpose() == PaymentPurpose.PAYMENT_PURPOSE_UNSPECIFIED || req.getPurpose() == PaymentPurpose.UNRECOGNIZED) {
            throw ServiceException.invalidArgument("PAYMENT_PURPOSE_INVALID", "purpose is required");
        }
        PaymentMethodKind kind = req.getMethod().getKind();
        if (kind != PaymentMethodKind.PAYMENT_METHOD_KIND_CARD && kind != PaymentMethodKind.PAYMENT_METHOD_KIND_CASH) {
            throw ServiceException.invalidArgument(PAYMENT_METHOD_INVALID, "method.kind must be CARD or CASH");
        }
        Money amount = money(req.hasAmount() ? req.getAmount() : null);
        if (!amount.isPositive()) {
            throw ServiceException.invalidArgument(PAYMENT_AMOUNT_INVALID, "amount must be positive");
        }
        return amount;
    }

    /** Strict proto → Money at the API edge. */
    public static Money money(lk.kade.common.v1.Money proto) {
        if (proto == null) {
            throw ServiceException.invalidArgument(PAYMENT_AMOUNT_INVALID, "amount is required");
        }
        try {
            return Money.fromProto(proto);
        } catch (IllegalArgumentException e) {
            throw ServiceException.invalidArgument(PAYMENT_AMOUNT_INVALID, e.getMessage());
        }
    }

    private static void requireSameCurrency(PaymentRow p, Money m) {
        if (!p.currency.equals(m.currency())) {
            throw ServiceException.invalidArgument(CURRENCY_MISMATCH, "payment is in " + p.currency);
        }
    }

    private PaymentAuthorised authorisedEvent(PaymentRow p) {
        return PaymentAuthorised.newBuilder()
                .setPaymentId(p.id.toString())
                .setPurpose(p.purposeProto())
                .setReferenceId(p.referenceId)
                .setCustomerId(p.customerId)
                .setMethod(p.methodKindProto())
                .setAmount(p.authorised().toProto())
                .setOccurredAt(Protos.ts(p.authorisedAt))
                .build();
    }

    private PaymentCaptured capturedEvent(PaymentRow p) {
        return PaymentCaptured.newBuilder()
                .setPaymentId(p.id.toString())
                .setPurpose(p.purposeProto())
                .setReferenceId(p.referenceId)
                .setCustomerId(p.customerId)
                .setMethod(p.methodKindProto())
                .setAmount(p.captured().toProto())
                .setCollectedByRiderId(p.collectedByRiderId)
                .setPspReference(p.pspReference)
                .setOccurredAt(Protos.ts(p.capturedAt))
                .build();
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }

    static byte[] sha256(byte[] bytes) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(bytes);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
