package lk.kade.ledger.grpc;

import io.grpc.ClientInterceptor;
import lk.kade.ledger.config.KadeProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.grpc.client.GlobalClientInterceptor;
import org.springframework.grpc.client.interceptor.DefaultDeadlineSetupClientInterceptor;

/**
 * Outgoing calls: every stub created through Spring gRPC's {@code GrpcChannelFactory} gets a default deadline
 * (CONVENTIONS: 2 s) unless the call sets one. Declare dependencies as named channels in application.yaml
 * ({@code spring.grpc.client.channels.catalog.address: ${CATALOG_GRPC}}) and inject stubs from them.
 */
@Configuration(proxyBeanMethods = false)
public class GrpcClientConfig {

    @Bean
    @GlobalClientInterceptor
    ClientInterceptor defaultDeadlineClientInterceptor(KadeProperties props) {
        return new DefaultDeadlineSetupClientInterceptor(props.grpc().defaultDeadline());
    }
}
