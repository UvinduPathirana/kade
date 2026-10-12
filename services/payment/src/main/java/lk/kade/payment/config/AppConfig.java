package lk.kade.payment.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class AppConfig {

    /** Inject time; tests replace it with {@code Clock.fixed(...)}. */
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}
