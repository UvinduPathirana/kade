package lk.kade.template.error;

/** Stable ErrorInfo reasons shared by every service. Service-specific reasons live next to the domain code. */
public final class ErrorReasons {
    public static final String UNAUTHENTICATED = "UNAUTHENTICATED";
    public static final String PERMISSION_DENIED = "PERMISSION_DENIED";
    public static final String INVALID_ARGUMENT = "INVALID_ARGUMENT";
    public static final String DEADLINE_EXCEEDED = "DEADLINE_EXCEEDED";
    /** Optimistic lock lost: the caller may re-read and retry. */
    public static final String CONCURRENT_MODIFICATION = "CONCURRENT_MODIFICATION";
    /** Same idempotency key sent with a different request body. */
    public static final String IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED";
    public static final String UNAVAILABLE = "UNAVAILABLE";
    public static final String INTERNAL = "INTERNAL";

    private ErrorReasons() {}
}
