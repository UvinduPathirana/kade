import { credentials, Metadata, type ServiceError } from "@grpc/grpc-js";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { GeoPoint } from "@kade/proto/kade/common/v1/types";
import {
  PricingServiceClient,
  type BatchQuoteDeliveryFeesResponse,
} from "@kade/proto/kade/pricing/v1/pricing_service";
import { CONFIG, type Config } from "../platform/config.js";
import { LOGGER, type Logger } from "../platform/logger.js";

export interface FeeQuote {
  feeMinor: number;
  distanceKm: number;
  outOfZone: boolean;
}

const DEADLINE_MS = 400;
/** After a failure, skip pricing for a while instead of adding the deadline to every call. */
const BACKOFF_MS = 10_000;

/**
 * Optional dependency on pricing: delivery fees on search results. Returns undefined when pricing
 * is unset, down or slow; results then carry no delivery_fee (gateways can fill it from catalog).
 */
@Injectable()
export class PricingGateway implements OnApplicationShutdown {
  private readonly client: PricingServiceClient | undefined;
  private downUntil = 0;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.client = config.PRICING_GRPC
      ? new PricingServiceClient(config.PRICING_GRPC, credentials.createInsecure())
      : undefined;
  }

  async quoteFees(
    restaurants: { id: string; lat: number; lng: number }[],
    deliverTo: GeoPoint,
  ): Promise<Map<string, FeeQuote> | undefined> {
    if (restaurants.length === 0) return new Map();
    const res = await this.call<BatchQuoteDeliveryFeesResponse>((client, md, deadline, cb) =>
      client.batchQuoteDeliveryFees(
        {
          restaurants: restaurants.map((r) => ({ restaurantId: r.id, location: { lat: r.lat, lng: r.lng } })),
          deliverTo,
        },
        md,
        { deadline },
        cb,
      ),
    );
    if (!res) return undefined;
    return new Map(
      res.fees.map((f) => [
        f.restaurantId,
        { feeMinor: f.fee?.amountMinor ?? 0, distanceKm: f.distanceKm, outOfZone: f.outOfZone },
      ]),
    );
  }

  private async call<T>(
    invoke: (
      client: PricingServiceClient,
      md: Metadata,
      deadline: Date,
      cb: (err: ServiceError | null, res: T) => void,
    ) => void,
  ): Promise<T | undefined> {
    const client = this.client;
    if (!client || Date.now() < this.downUntil) return undefined;
    try {
      return await new Promise<T>((resolve, reject) =>
        invoke(client, new Metadata(), new Date(Date.now() + DEADLINE_MS), (err, res) =>
          err ? reject(err) : resolve(res),
        ),
      );
    } catch (err) {
      this.downUntil = Date.now() + BACKOFF_MS;
      this.logger.warn({ err: (err as Error).message }, "pricing unavailable; results without delivery fees");
      return undefined;
    }
  }

  onApplicationShutdown(): void {
    this.client?.close();
  }
}
