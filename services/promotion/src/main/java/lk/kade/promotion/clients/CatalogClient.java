package lk.kade.promotion.clients;

import io.grpc.StatusRuntimeException;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import lk.kade.catalog.v1.CatalogServiceGrpc;
import lk.kade.catalog.v1.GetRestaurantRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Restaurant names for messages and offer-page details, cached for ten minutes. Best effort: when catalog is
 * slow or down the caller falls back to wording without the name.
 */
@Component
public class CatalogClient {

    private static final Logger log = LoggerFactory.getLogger(CatalogClient.class);
    private static final Duration TTL = Duration.ofMinutes(10);
    private static final long DEADLINE_MS = 800;

    private final CatalogServiceGrpc.CatalogServiceBlockingStub stub;
    private final ConcurrentHashMap<String, Cached> cache = new ConcurrentHashMap<>();

    public CatalogClient(Channels channels, DependencyProperties deps) {
        this.stub = CatalogServiceGrpc.newBlockingStub(channels.open(deps.catalogGrpc()));
    }

    private record Cached(String name, Instant at) {}

    public Optional<String> restaurantName(String restaurantId) {
        if (restaurantId == null || restaurantId.isBlank()) {
            return Optional.empty();
        }
        Cached hit = cache.get(restaurantId);
        if (hit != null && hit.at.plus(TTL).isAfter(Instant.now())) {
            return Optional.of(hit.name).filter(n -> !n.isEmpty());
        }
        try {
            String name = stub.withDeadlineAfter(DEADLINE_MS, TimeUnit.MILLISECONDS)
                    .getRestaurant(GetRestaurantRequest.newBuilder().setId(restaurantId).build())
                    .getRestaurant().getName();
            cache.put(restaurantId, new Cached(name, Instant.now()));
            return Optional.of(name).filter(n -> !n.isEmpty());
        } catch (StatusRuntimeException e) {
            log.debug("catalog name lookup for {} failed: {}", restaurantId, e.getStatus());
            return Optional.empty();
        }
    }
}
