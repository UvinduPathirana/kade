package lk.kade.promotion.grpc;

import io.grpc.Context;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import lk.kade.promotion.error.ServiceException;

/**
 * Who is calling, as asserted by a gateway in gRPC metadata ({@code x-user-id}, {@code x-roles},
 * {@code x-outlet-id}). Services trust the internal network and authorise from this; they never see JWTs.
 * Available anywhere on the request thread via {@link #current()}.
 */
public record Caller(String userId, Set<String> roles, String outletId) {

    public static final Caller ANONYMOUS = new Caller("", Set.of(), "");

    static final Context.Key<Caller> KEY = Context.keyWithDefault("kade-caller", ANONYMOUS);

    public static Caller current() {
        return KEY.get();
    }

    /** Parses {@code x-roles}: comma- or space-separated role names. */
    static Set<String> parseRoles(String header) {
        if (header == null || header.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(header.split("[,\\s]+")).filter(s -> !s.isBlank()).collect(Collectors.toUnmodifiableSet());
    }

    public boolean authenticated() {
        return !userId.isEmpty();
    }

    public boolean hasRole(String role) {
        return roles.contains(role);
    }

    public Caller requireAuthenticated() {
        if (!authenticated()) {
            throw ServiceException.unauthenticated("missing x-user-id");
        }
        return this;
    }

    public Caller requireAnyRole(String... anyOf) {
        requireAuthenticated();
        for (String role : anyOf) {
            if (roles.contains(role)) {
                return this;
            }
        }
        throw ServiceException.permissionDenied("requires one of " + String.join(", ", anyOf));
    }
}
