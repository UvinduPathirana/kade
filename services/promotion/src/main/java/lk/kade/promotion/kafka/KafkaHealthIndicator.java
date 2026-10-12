package lk.kade.promotion.kafka;

import java.util.concurrent.TimeUnit;
import lk.kade.promotion.config.KadeProperties;
import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.DescribeClusterOptions;
import org.apache.kafka.clients.admin.DescribeClusterResult;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/** Readiness contributor {@code kafka}: the cluster answers a metadata request within the timeout. */
@Component("kafka")
public class KafkaHealthIndicator implements HealthIndicator {

    private final AdminClient admin;
    private final long timeoutMs;

    public KafkaHealthIndicator(AdminClient healthAdminClient, KadeProperties props) {
        this.admin = healthAdminClient;
        this.timeoutMs = props.kafka().healthTimeout().toMillis();
    }

    @Override
    public Health health() {
        try {
            DescribeClusterResult cluster = admin.describeCluster(new DescribeClusterOptions().timeoutMs((int) timeoutMs));
            String clusterId = cluster.clusterId().get(timeoutMs, TimeUnit.MILLISECONDS);
            int nodes = cluster.nodes().get(timeoutMs, TimeUnit.MILLISECONDS).size();
            return Health.up().withDetail("clusterId", clusterId).withDetail("nodes", nodes).build();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Health.down(e).build();
        } catch (Exception e) {
            return Health.down().withDetail("error", e.getClass().getSimpleName() + ": " + e.getMessage()).build();
        }
    }
}
