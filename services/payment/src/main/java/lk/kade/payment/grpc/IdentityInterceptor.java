package lk.kade.payment.grpc;

import io.grpc.Context;
import io.grpc.Contexts;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.grpc.server.GlobalServerInterceptor;
import org.springframework.stereotype.Component;

/** Copies the gateway-asserted identity metadata into {@link Caller#current()} for every call. */
@Component
@GlobalServerInterceptor
@Order(Ordered.HIGHEST_PRECEDENCE + 100)
public class IdentityInterceptor implements ServerInterceptor {

    static final Metadata.Key<String> USER_ID = Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER);
    static final Metadata.Key<String> ROLES = Metadata.Key.of("x-roles", Metadata.ASCII_STRING_MARSHALLER);
    static final Metadata.Key<String> OUTLET_ID = Metadata.Key.of("x-outlet-id", Metadata.ASCII_STRING_MARSHALLER);

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
        Iterable<String> roleHeaders = headers.getAll(ROLES);
        String roles = roleHeaders == null ? "" : String.join(",", roleHeaders);
        Caller caller = new Caller(
                nullToEmpty(headers.get(USER_ID)), Caller.parseRoles(roles), nullToEmpty(headers.get(OUTLET_ID)));
        return Contexts.interceptCall(Context.current().withValue(Caller.KEY, caller), call, headers, next);
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s.trim();
    }
}
