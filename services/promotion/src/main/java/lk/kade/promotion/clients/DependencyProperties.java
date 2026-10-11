package lk.kade.promotion.clients;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Addresses of the services promotion calls (CONVENTIONS {@code <NAME>_GRPC}) and, for the ones that may not be
 * running yet, a {@code grpc|stub} mode like the order service's ({@code PAYMENT_MODE}, {@code PROFILE_MODE}).
 *
 * @param catalogGrpc  restaurant names for user-facing messages ("FIRSTKOTTU only works at …")
 * @param paymentGrpc  gift card purchases (AuthorisePayment + CapturePayment, saved card labels)
 * @param profileGrpc  Kadé credit for gift card redemptions and referral rewards (ChangeCredit)
 */
@ConfigurationProperties("kade.deps")
public record DependencyProperties(
        @DefaultValue("localhost:50101") String catalogGrpc,
        @DefaultValue("localhost:50108") String paymentGrpc,
        @DefaultValue("localhost:50103") String profileGrpc,
        @DefaultValue("grpc") String paymentMode,
        @DefaultValue("grpc") String profileMode,
        @DefaultValue("2s") Duration deadline) {

    public boolean paymentStubbed() {
        return "stub".equalsIgnoreCase(paymentMode);
    }

    public boolean profileStubbed() {
        return "stub".equalsIgnoreCase(profileMode);
    }
}
