package lk.kade.payment.psp;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** HMAC-SHA256 webhook signatures, header value {@code sha256=<hex>} over the raw body. */
@Component
public class WebhookSigner {

    public static final String PREFIX = "sha256=";

    private final byte[] secret;

    public WebhookSigner(@Value("${kade.psp.webhook-secret}") String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    public String sign(byte[] payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return PREFIX + HexFormat.of().formatHex(mac.doFinal(payload));
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Constant-time comparison. */
    public boolean verify(byte[] payload, String signature) {
        if (signature == null || !signature.startsWith(PREFIX)) {
            return false;
        }
        return MessageDigest.isEqual(sign(payload).getBytes(StandardCharsets.US_ASCII),
                signature.getBytes(StandardCharsets.US_ASCII));
    }
}
