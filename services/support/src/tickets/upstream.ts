import { credentials, Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { Money } from "@kade/proto/kade/common/v1/money";
import type { RefundMethod } from "@kade/proto/kade/common/v1/commerce";
import { OrderServiceClient, type Order, type Refund } from "@kade/proto/kade/order/v1/order_service";
import {
  CreditReason,
  CreditServiceClient,
  type CreditEntry,
} from "@kade/proto/kade/profile/v1/profile_service";
import { CONFIG, type Config } from "../platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../platform/grpc/error-details.js";
import { DomainError, notFound } from "../platform/grpc/errors.js";
import { LOGGER, type Logger } from "../platform/logger.js";

/** Who support calls other services as: the agent when there is one, else the service itself. */
export interface Caller {
  userId?: string;
  roles?: readonly string[];
}

const UNREACHABLE = new Set([
  status.UNAVAILABLE,
  status.DEADLINE_EXCEEDED,
  status.UNIMPLEMENTED,
  status.CANCELLED,
]);

/**
 * Order (GetOrder, RefundOrder) and profile (ChangeCredit) over gRPC, each call with a deadline.
 * Business errors from them (REFUND_EXCEEDS_REMAINING, CASH_ORDER_REFUND_TO_CREDIT, …) pass through
 * with their reason; an unreachable upstream becomes UNAVAILABLE with ORDER_SERVICE_UNAVAILABLE /
 * PROFILE_SERVICE_UNAVAILABLE and a message saying nothing was paid.
 */
@Injectable()
export class Upstream implements OnApplicationShutdown {
  private readonly order: OrderServiceClient;
  private readonly credit: CreditServiceClient;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.order = new OrderServiceClient(config.ORDER_GRPC, credentials.createInsecure());
    this.credit = new CreditServiceClient(config.PROFILE_GRPC, credentials.createInsecure());
  }

  async getOrder(orderId: string, caller: Caller = {}): Promise<Order> {
    const res = await this.call<{ order?: Order }>(
      "order",
      (md, opts, cb) => this.order.getOrder({ orderId, orderNumber: "" }, md, opts, cb),
      caller,
    );
    if (!res.order) throw notFound("ORDER_NOT_FOUND", "We couldn't find that order.");
    return res.order;
  }

  /** Best effort: undefined when order is down or doesn't know the id (used for display only). */
  async findOrder(orderId: string, caller: Caller = {}): Promise<Order | undefined> {
    try {
      return await this.getOrder(orderId, caller);
    } catch (err) {
      this.logger.debug({ err, orderId }, "order lookup failed");
      return undefined;
    }
  }

  async refundOrder(
    input: {
      orderId: string;
      amount: Money;
      method: RefundMethod;
      reason: string;
      by: string;
      ticketId: string;
      idempotencyKey: string;
    },
    caller: Caller = {},
  ): Promise<{ order?: Order; refund?: Refund }> {
    return this.call("order", (md, opts, cb) => this.order.refundOrder(input, md, opts, cb), caller);
  }

  async addGoodwillCredit(
    input: {
      customerId: string;
      amountMinor: number;
      label: string;
      ticketId: string;
      by: string;
      idempotencyKey: string;
    },
    caller: Caller = {},
  ): Promise<CreditEntry | undefined> {
    const res = await this.call<{ entry?: CreditEntry }>(
      "profile",
      (md, opts, cb) =>
        this.credit.changeCredit(
          {
            customerId: input.customerId,
            amount: { amountMinor: input.amountMinor, currency: "LKR" },
            reason: CreditReason.CREDIT_REASON_GOODWILL,
            label: input.label,
            orderId: "",
            ticketId: input.ticketId,
            by: input.by,
            idempotencyKey: input.idempotencyKey,
          },
          md,
          opts,
          cb,
        ),
      caller,
    );
    return res.entry;
  }

  private call<T>(
    upstream: "order" | "profile",
    invoke: (
      md: Metadata,
      opts: { deadline: number },
      cb: (err: ServiceError | null, res: T) => void,
    ) => unknown,
    caller: Caller,
  ): Promise<T> {
    const md = new Metadata();
    md.set("x-user-id", caller.userId || "support-service");
    md.set("x-roles", (caller.roles?.length ? caller.roles : ["support"]).join(","));
    return new Promise<T>((resolve, reject) => {
      invoke(md, { deadline: Date.now() + this.config.GRPC_CLIENT_TIMEOUT_MS }, (err, res) =>
        err ? reject(this.translate(upstream, err)) : resolve(res),
      );
    });
  }

  private translate(upstream: "order" | "profile", err: ServiceError): DomainError {
    if (UNREACHABLE.has(err.code)) {
      this.logger.warn({ err: err.message, code: err.code, upstream }, "upstream unavailable");
      return upstream === "order"
        ? new DomainError(
            status.UNAVAILABLE,
            "ORDER_SERVICE_UNAVAILABLE",
            "We couldn't reach the order service, so nothing was refunded. Try again in a minute.",
          )
        : new DomainError(
            status.UNAVAILABLE,
            "PROFILE_SERVICE_UNAVAILABLE",
            "We couldn't reach the customer service, so no credit was added. Try again in a minute.",
          );
    }
    const details = err.metadata?.get(STATUS_DETAILS_KEY)[0];
    const info = details ? decodeErrorInfo(details as Buffer) : undefined;
    if (err.code === status.NOT_FOUND && (!info || info.reason === "ORDER_NOT_FOUND")) {
      return notFound(
        upstream === "order" ? "ORDER_NOT_FOUND" : "CUSTOMER_NOT_FOUND",
        "We couldn't find that record.",
      );
    }
    if (info?.reason)
      return new DomainError(err.code, info.reason, err.details || err.message, info.metadata);
    this.logger.error({ err, upstream }, "upstream call failed");
    return new DomainError(status.INTERNAL, "UPSTREAM_ERROR", `The ${upstream} service returned an error.`);
  }

  onApplicationShutdown(): void {
    this.order.close();
    this.credit.close();
  }
}
