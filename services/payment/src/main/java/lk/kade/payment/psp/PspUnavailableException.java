package lk.kade.payment.psp;

/** The PSP could not be reached or answered with a processing error. Retryable (unlike a decline). */
public class PspUnavailableException extends RuntimeException {

    public PspUnavailableException(String message) {
        super(message);
    }
}
