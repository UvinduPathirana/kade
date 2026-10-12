package lk.kade.payment.idempotency;

import com.google.protobuf.InvalidProtocolBufferException;
import com.google.protobuf.Message;
import com.google.protobuf.Parser;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.function.Supplier;
import lk.kade.payment.error.ErrorReasons;
import lk.kade.payment.error.ServiceException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Exactly-once results for retried mutating RPCs.
 *
 * <p>Opens (or joins) one transaction; the action's own {@code @Transactional} methods join it:
 * <ol>
 *   <li>{@code INSERT ... ON CONFLICT DO NOTHING} claims the key. If another request holding the same key is still
 *       in flight, Postgres blocks this insert until that transaction commits or rolls back, so two concurrent
 *       retries can never both run the action.
 *   <li>Claimed: run the action, store its protobuf response in the same transaction, return it.
 *   <li>Already there: compare the request hash (reject a reused key with a different body) and return the stored
 *       response without running the action.
 * </ol>
 * Because the response commits with the business change, a crash between them is impossible.
 */
@Component
public class IdempotencyService {

    private final JdbcClient jdbc;

    public IdempotencyService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public <T extends Message> T execute(
            String operation, String principal, String key, Message requestWithoutKey,
            Parser<T> responseParser, Supplier<T> action) {
        byte[] hash = sha256(requestWithoutKey.toByteArray());
        int claimed = jdbc.sql("""
                INSERT INTO idempotency_keys (operation, principal, idempotency_key, request_hash)
                VALUES (:op, :principal, :key, :hash)
                ON CONFLICT DO NOTHING
                """)
                .param("op", operation).param("principal", principal).param("key", key).param("hash", hash)
                .update();
        if (claimed == 1) {
            T response = action.get();
            jdbc.sql("""
                    UPDATE idempotency_keys SET response = :response
                    WHERE operation = :op AND principal = :principal AND idempotency_key = :key
                    """)
                    .param("response", response.toByteArray())
                    .param("op", operation).param("principal", principal).param("key", key)
                    .update();
            return response;
        }
        Stored stored = jdbc.sql("""
                SELECT request_hash, response FROM idempotency_keys
                WHERE operation = :op AND principal = :principal AND idempotency_key = :key
                """)
                .param("op", operation).param("principal", principal).param("key", key)
                .query((rs, n) -> new Stored(rs.getBytes(1), rs.getBytes(2)))
                .single();
        if (!Arrays.equals(stored.requestHash, hash)) {
            throw ServiceException.failedPrecondition(ErrorReasons.IDEMPOTENCY_KEY_REUSED,
                    "idempotency key was already used with a different request");
        }
        if (stored.response == null) {
            // Cannot happen: the response is written in the transaction that inserted the key.
            throw new IllegalStateException("idempotency key without a stored response");
        }
        try {
            return responseParser.parseFrom(stored.response);
        } catch (InvalidProtocolBufferException e) {
            throw new IllegalStateException("stored idempotent response is not decodable", e);
        }
    }

    private record Stored(byte[] requestHash, byte[] response) {}

    static byte[] sha256(byte[] bytes) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(bytes);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
