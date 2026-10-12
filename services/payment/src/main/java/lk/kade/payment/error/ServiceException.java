package lk.kade.payment.error;

import io.grpc.Status;
import java.util.Map;

/**
 * The one exception type domain code throws for expected failures. It carries a gRPC status code and a stable,
 * machine-readable {@code reason} (UPPER_SNAKE, e.g. {@code PROMO_MIN_SUBTOTAL}) that gateways map to the message
 * the apps show. The message is for logs and developers, never parsed by callers.
 */
public class ServiceException extends RuntimeException {

    private final Status.Code code;
    private final String reason;
    private final Map<String, String> metadata;

    public ServiceException(Status.Code code, String reason, String message) {
        this(code, reason, message, Map.of());
    }

    public ServiceException(Status.Code code, String reason, String message, Map<String, String> metadata) {
        super(message);
        this.code = code;
        this.reason = reason;
        this.metadata = Map.copyOf(metadata);
    }

    public Status.Code code() { return code; }

    public String reason() { return reason; }

    public Map<String, String> metadata() { return metadata; }

    public static ServiceException invalidArgument(String reason, String message) {
        return new ServiceException(Status.Code.INVALID_ARGUMENT, reason, message);
    }

    public static ServiceException notFound(String reason, String message) {
        return new ServiceException(Status.Code.NOT_FOUND, reason, message);
    }

    public static ServiceException failedPrecondition(String reason, String message) {
        return new ServiceException(Status.Code.FAILED_PRECONDITION, reason, message);
    }

    public static ServiceException unauthenticated(String message) {
        return new ServiceException(Status.Code.UNAUTHENTICATED, ErrorReasons.UNAUTHENTICATED, message);
    }

    public static ServiceException permissionDenied(String message) {
        return new ServiceException(Status.Code.PERMISSION_DENIED, ErrorReasons.PERMISSION_DENIED, message);
    }
}
