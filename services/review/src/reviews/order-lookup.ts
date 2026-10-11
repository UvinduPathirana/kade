import { credentials, Metadata } from "@grpc/grpc-js";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { OrderServiceClient, OrderStatus, type Order } from "@kade/proto/kade/order/v1/order_service";
import { CONFIG, type Config } from "../platform/config.js";
import { LOGGER, type Logger } from "../platform/logger.js";

/**
 * Fallback read of an order from the order service, for a customer who rates before the
 * OrderDelivered event reached us. Best effort: returns undefined when order is unset, down or slow
 * (2 s deadline), and the caller answers ORDER_NOT_RATEABLE as it would without the fallback.
 */
@Injectable()
export class OrderLookup implements OnApplicationShutdown {
  private readonly client: OrderServiceClient | undefined;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.client = config.ORDER_GRPC
      ? new OrderServiceClient(config.ORDER_GRPC, credentials.createInsecure())
      : undefined;
  }

  /** The order when it is DELIVERED or COLLECTED. */
  async completedOrder(orderId: string): Promise<Order | undefined> {
    const client = this.client;
    if (!client) return undefined;
    const md = new Metadata();
    md.set("x-user-id", "review-service");
    md.set("x-roles", "ops");
    try {
      const res = await new Promise<{ order?: Order }>((resolve, reject) =>
        client.getOrder(
          { orderId, orderNumber: "" },
          md,
          { deadline: Date.now() + this.config.GRPC_CLIENT_TIMEOUT_MS },
          (err, r) => (err ? reject(err) : resolve(r)),
        ),
      );
      const order = res.order;
      const done =
        order?.status === OrderStatus.ORDER_STATUS_DELIVERED ||
        order?.status === OrderStatus.ORDER_STATUS_COLLECTED;
      return done ? order : undefined;
    } catch (err) {
      this.logger.warn({ err, orderId }, "order lookup failed");
      return undefined;
    }
  }

  onApplicationShutdown(): void {
    this.client?.close();
  }
}
