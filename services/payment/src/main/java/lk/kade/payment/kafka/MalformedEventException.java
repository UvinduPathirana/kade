package lk.kade.payment.kafka;

/** The record can never succeed (missing headers, undecodable payload): skip retries, go straight to the DLQ. */
public class MalformedEventException extends RuntimeException {
    public MalformedEventException(String message) { super(message); }
    public MalformedEventException(String message, Throwable cause) { super(message, cause); }
}
