package lk.kade.payment;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.ResponseEntity;

/** The CONVENTIONS HTTP surface: /health/live, /health/ready (DB + Kafka), /metrics (Prometheus). */
class ActuatorIT extends IntegrationTestBase {

    @Autowired
    TestRestTemplate http;

    @Test
    void liveness() {
        ResponseEntity<String> res = http.getForEntity("/health/live", String.class);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("\"status\":\"UP\"");
    }

    @Test
    void readinessChecksDatabaseAndKafka() {
        ResponseEntity<String> res = http.getForEntity("/health/ready", String.class);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("\"db\"", "\"kafka\"").doesNotContain("DOWN");
    }

    @Test
    void prometheusMetrics() {
        ResponseEntity<String> res = http.getForEntity("/metrics", String.class);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("jvm_memory_used_bytes", "hikaricp_connections", "service=\"payment-it\"");
    }
}
