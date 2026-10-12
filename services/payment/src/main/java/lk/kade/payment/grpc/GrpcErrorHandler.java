package lk.kade.payment.grpc;

import com.google.protobuf.Any;
import com.google.rpc.ErrorInfo;
import io.grpc.Status;
import io.grpc.StatusException;
import io.grpc.StatusRuntimeException;
import io.grpc.protobuf.StatusProto;
import lk.kade.payment.config.KadeProperties;
import lk.kade.payment.error.ErrorReasons;
import lk.kade.payment.error.ServiceException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.grpc.server.exception.GrpcExceptionHandler;
import org.springframework.stereotype.Component;

/**
 * Turns anything a handler throws into a gRPC status plus a {@code google.rpc.ErrorInfo} detail with a stable
 * reason (CONVENTIONS "Synchronous calls"). Gateways read the reason; the message is never shown to users and
 * unexpected errors never leak internals.
 */
@Component
public class GrpcErrorHandler implements GrpcExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GrpcErrorHandler.class);

    private final String domain;

    public GrpcErrorHandler(KadeProperties props) {
        this.domain = props.serviceName(); // ErrorInfo.domain = SERVICE_NAME, same as the Go and TS templates
    }

    @Override
    public StatusException handleException(Throwable ex) {
        if (ex instanceof ServiceException se) {
            if (se.code() == Status.Code.INTERNAL) {
                log.error("{}: {}", se.reason(), se.getMessage(), se);
            } else {
                log.info("{} {}: {}", se.code(), se.reason(), se.getMessage());
            }
            return toStatus(se.code(), se.reason(), se.getMessage(), se.metadata());
        }
        if (ex instanceof StatusException || ex instanceof StatusRuntimeException) {
            Status status = Status.fromThrowable(ex);
            return toStatus(status.getCode(), status.getCode().name(), status.getDescription(), java.util.Map.of());
        }
        if (ex instanceof QueryTimeoutException) {
            return toStatus(Status.Code.DEADLINE_EXCEEDED, ErrorReasons.DEADLINE_EXCEEDED, "query timed out", java.util.Map.of());
        }
        if (ex instanceof DataAccessResourceFailureException || ex instanceof TransientDataAccessException) {
            log.warn("transient data access failure", ex);
            return toStatus(Status.Code.UNAVAILABLE, ErrorReasons.UNAVAILABLE, "temporarily unavailable", java.util.Map.of());
        }
        log.error("unhandled exception in gRPC call", ex);
        return toStatus(Status.Code.INTERNAL, ErrorReasons.INTERNAL, "internal error", java.util.Map.of());
    }

    StatusException toStatus(Status.Code code, String reason, String message, java.util.Map<String, String> metadata) {
        ErrorInfo info = ErrorInfo.newBuilder().setReason(reason).setDomain(domain).putAllMetadata(metadata).build();
        com.google.rpc.Status status = com.google.rpc.Status.newBuilder()
                .setCode(code.value())
                .setMessage(message == null ? "" : message)
                .addDetails(Any.pack(info))
                .build();
        return StatusProto.toStatusException(status);
    }
}
