import { Inject, Injectable } from "@nestjs/common";
import { Channel } from "@kade/proto/kade/notification/v1/notification_service";
import { LOGGER, type Logger } from "../platform/logger.js";
import type { PushDeviceRow } from "./notifications.repository.js";

export interface OutgoingMessage {
  id: string;
  channel: Channel;
  to: { userId?: string | null; phone?: string | null; email?: string | null; name?: string | null };
  body: string;
  subject?: string;
  devices?: PushDeviceRow[];
}

/**
 * Stand-in for the SMS gateway, FCM/APNs and the email provider. Nothing leaves the machine: the
 * message is logged (Loki: {service_name="notification"} |= "dev-sink") and the caller stores it,
 * so ops and support see exactly what a customer would have received. The provider reference is
 * derived from the notification id, which makes a resend of the same notification idempotent.
 */
@Injectable()
export class DevSink {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  async deliver(message: OutgoingMessage): Promise<{ providerReference: string }> {
    const channel = Channel[message.channel]?.replace("CHANNEL_", "").toLowerCase() ?? "unknown";
    this.logger.info(
      {
        sink: "dev-sink",
        channel,
        notificationId: message.id,
        to: message.to.phone ?? message.to.email ?? message.to.userId,
        devices: message.devices?.length,
        subject: message.subject,
        body: message.body,
      },
      `dev-sink ${channel}: ${message.body}`,
    );
    return { providerReference: `dev-${channel}-${message.id}` };
  }
}
