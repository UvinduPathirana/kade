package lk.kade.template.outbox;

import java.security.SecureRandom;
import java.util.UUID;

/** UUIDv7 (RFC 9562): 48-bit Unix millis + random. Time-ordered, so B-tree inserts stay local. */
public final class UuidV7 {

    private static final SecureRandom RANDOM = new SecureRandom();

    private UuidV7() {}

    public static UUID next() {
        long millis = System.currentTimeMillis();
        long randA = RANDOM.nextInt(1 << 12);
        long msb = (millis << 16) | 0x7000L | randA;          // 48 bits time, version 7, 12 random bits
        long lsb = (RANDOM.nextLong() & 0x3FFFFFFFFFFFFFFFL) | 0x8000000000000000L; // variant 10
        return new UUID(msb, lsb);
    }
}
