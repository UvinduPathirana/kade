import { credentials, Metadata, type Client } from "@grpc/grpc-js";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { GeoPoint } from "@kade/proto/kade/common/v1/types";
import {
  Channel,
  NotificationServiceClient,
  RecipientKind,
} from "@kade/proto/kade/notification/v1/notification_service";
import { PricingServiceClient } from "@kade/proto/kade/pricing/v1/pricing_service";
import { CONFIG, type Config } from "../platform/config.js";
import { LOGGER, type Logger } from "../platform/logger.js";

const DEADLINE_MS = 2_000;

/**
 * Optional calls to other services. Each dependency is off unless its <NAME>_GRPC address is set,
 * and none of them is on the critical path: a failure is logged and the caller carries on.
 */
@Injectable()
export class Downstream implements OnApplicationShutdown {
  private readonly pricing: PricingServiceClient | undefined;
  private readonly notification: NotificationServiceClient | undefined;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    const insecure = credentials.createInsecure();
    this.pricing = config.PRICING_GRPC ? new PricingServiceClient(config.PRICING_GRPC, insecure) : undefined;
    this.notification = config.NOTIFICATION_GRPC
      ? new NotificationServiceClient(config.NOTIFICATION_GRPC, insecure)
      : undefined;
  }

  /** pricing.ResolveZone. undefined = pricing not configured or unreachable (keep what we have). */
  async resolveZone(location: GeoPoint): Promise<string | undefined> {
    const client = this.pricing;
    if (!client) return undefined;
    try {
      const res = await new Promise<{ zone?: { id: string }; inZone: boolean }>((resolve, reject) =>
        client.resolveZone({ location }, new Metadata(), { deadline: Date.now() + DEADLINE_MS }, (err, r) =>
          err ? reject(err) : resolve(r),
        ),
      );
      return res.inZone && res.zone ? res.zone.id : "";
    } catch (err) {
      this.logger.warn({ err }, "pricing.ResolveZone failed; saving the address without a zone");
      return undefined;
    }
  }

  /** Sends the sign-in code by SMS through notification. Returns false when it couldn't. */
  async sendOtpSms(phone: string, code: string, challengeId: string): Promise<boolean> {
    const client = this.notification;
    if (!client) return false;
    try {
      await new Promise((resolve, reject) =>
        client.sendNotification(
          {
            channel: Channel.CHANNEL_SMS,
            recipient: {
              kind: RecipientKind.RECIPIENT_KIND_ANONYMOUS,
              userId: "",
              phone,
              email: "",
              name: "",
            },
            template: "otp",
            params: { code },
            referenceId: challengeId,
            transactional: true,
            idempotencyKey: `otp:${challengeId}`,
          },
          new Metadata(),
          { deadline: Date.now() + DEADLINE_MS },
          (err, r) => (err ? reject(err) : resolve(r)),
        ),
      );
      return true;
    } catch (err) {
      this.logger.warn({ err }, "notification.SendNotification (OTP) failed");
      return false;
    }
  }

  onApplicationShutdown(): void {
    for (const c of [this.pricing, this.notification] as (Client | undefined)[]) c?.close();
  }
}
