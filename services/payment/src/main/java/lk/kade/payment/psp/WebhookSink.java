package lk.kade.payment.psp;

/** Where PSP webhooks land (implemented by the webhook processor; also reached over HTTP and gRPC). */
public interface WebhookSink {

    void deliver(String provider, String signature, byte[] payload);
}
