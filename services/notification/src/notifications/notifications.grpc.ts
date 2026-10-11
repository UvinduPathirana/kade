import { Inject, Injectable } from "@nestjs/common";
import {
  Channel,
  NotificationServiceService,
  RecipientKind,
  type GetNotificationRequest,
  type GetNotificationResponse,
  type ListNotificationsRequest,
  type ListNotificationsResponse,
  type RegisterPushDeviceRequest,
  type RegisterPushDeviceResponse,
  type SendNotificationRequest,
  type SendNotificationResponse,
  type UnregisterPushDeviceRequest,
  type UnregisterPushDeviceResponse,
} from "@kade/proto/kade/notification/v1/notification_service";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument, notFound, permissionDenied } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { NotificationsRepository } from "./notifications.repository.js";
import { Notifier, toProto } from "./notifier.js";
import { render } from "./templates.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_ROLES = ["ops", "support", "admin"];
const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/**
 * kade.notification.v1.NotificationService. SendNotification is called service-to-service (profile
 * for OTPs, dispatch for masked rider messages) without user identity; reads are for the owner or
 * Kadé staff.
 */
@GrpcService(NotificationServiceService)
@Injectable()
export class NotificationGrpcService implements GrpcHandlers<NotificationServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(NotificationsRepository) private readonly repo: NotificationsRepository,
    @Inject(Notifier) private readonly notifier: Notifier,
  ) {}

  async sendNotification(
    request: SendNotificationRequest,
    ctx: RequestContext,
  ): Promise<SendNotificationResponse> {
    const recipient = request.recipient;
    if (!recipient || recipient.kind === RecipientKind.RECIPIENT_KIND_UNSPECIFIED) {
      throw invalidArgument("RECIPIENT_REQUIRED", "Say who the message is for.", { field: "recipient" });
    }
    if (!recipient.userId && !recipient.phone && !recipient.email) {
      throw invalidArgument("RECIPIENT_REQUIRED", "The recipient needs a user id, phone or email.", {
        field: "recipient",
      });
    }
    if (request.channel === Channel.CHANNEL_SMS && !recipient.phone) {
      throw invalidArgument("RECIPIENT_PHONE_REQUIRED", "A phone number is needed to send an SMS.", {
        field: "recipient.phone",
      });
    }
    if (request.channel === Channel.CHANNEL_EMAIL && !recipient.email) {
      throw invalidArgument("RECIPIENT_EMAIL_REQUIRED", "An email address is needed to send an email.", {
        field: "recipient.email",
      });
    }
    render(request.template, request.params); // validate before opening a transaction

    const row = await this.database.transaction(ctx, (tx) =>
      this.notifier.send(tx, {
        channel: request.channel,
        recipient,
        template: request.template,
        params: request.params,
        referenceId: request.referenceId,
        sendAt: request.sendAt,
        idempotencyKey: request.idempotencyKey ? `rpc:${request.idempotencyKey}` : undefined,
      }),
    );
    return { notification: toProto(row) };
  }

  async getNotification(
    request: GetNotificationRequest,
    ctx: RequestContext,
  ): Promise<GetNotificationResponse> {
    if (!UUID.test(request.notificationId)) {
      throw invalidArgument("NOTIFICATION_ID_INVALID", "Notification id must be a UUID.", {
        field: "notification_id",
      });
    }
    const row = await this.repo.findById(this.database.db, request.notificationId);
    if (!row || !canRead(ctx, row.userId ?? undefined)) {
      throw notFound("NOTIFICATION_NOT_FOUND", "We couldn't find that message.");
    }
    return { notification: toProto(row) };
  }

  async listNotifications(
    request: ListNotificationsRequest,
    ctx: RequestContext,
  ): Promise<ListNotificationsResponse> {
    if (!request.userId && !request.referenceId) {
      throw invalidArgument("FILTER_REQUIRED", "Give a user id or a reference id.", { field: "user_id" });
    }
    if (!STAFF_ROLES.some((r) => ctx.hasRole(r))) {
      if (!request.userId || request.userId !== ctx.userId) {
        throw permissionDenied("PERMISSION_DENIED", "You can only see your own messages.");
      }
    }
    const before = request.page?.pageToken || undefined;
    if (before && !UUID.test(before)) {
      throw invalidArgument("PAGE_TOKEN_INVALID", "That page token isn't valid.", {
        field: "page.page_token",
      });
    }
    const limit = Math.min(Math.max(request.page?.pageSize || DEFAULT_PAGE, 1), MAX_PAGE);
    const filter = { userId: request.userId || undefined, referenceId: request.referenceId || undefined };
    const [rows, total] = await Promise.all([
      this.repo.list(this.database.db, { ...filter, before, limit: limit + 1 }),
      this.repo.count(this.database.db, filter),
    ]);
    const page = rows.slice(0, limit);
    return {
      notifications: page.map(toProto),
      page: { nextPageToken: rows.length > limit ? page[page.length - 1]!.id : "", totalSize: total },
    };
  }

  async registerPushDevice(
    request: RegisterPushDeviceRequest,
    ctx: RequestContext,
  ): Promise<RegisterPushDeviceResponse> {
    const userId = request.userId || ctx.userId;
    if (!userId) throw invalidArgument("USER_ID_REQUIRED", "Say whose device this is.", { field: "user_id" });
    if (ctx.userId && ctx.userId !== userId && !STAFF_ROLES.some((r) => ctx.hasRole(r))) {
      throw permissionDenied("PERMISSION_DENIED", "You can only register your own devices.");
    }
    if (!request.deviceId || !request.token) {
      throw invalidArgument("DEVICE_REQUIRED", "A device id and push token are needed.", { field: "token" });
    }
    await this.repo.upsertDevice(this.database.db, {
      userId,
      deviceId: request.deviceId,
      kind: request.kind,
      platform: request.platform,
      token: request.token,
    });
    return {};
  }

  async unregisterPushDevice(
    request: UnregisterPushDeviceRequest,
    ctx: RequestContext,
  ): Promise<UnregisterPushDeviceResponse> {
    const userId = request.userId || ctx.userId;
    if (!userId || !request.deviceId) {
      throw invalidArgument("DEVICE_REQUIRED", "Say which device to remove.", { field: "device_id" });
    }
    await this.repo.deleteDevice(this.database.db, userId, request.deviceId);
    return {};
  }
}

function canRead(ctx: RequestContext, ownerId: string | undefined): boolean {
  return STAFF_ROLES.some((r) => ctx.hasRole(r)) || (ownerId !== undefined && ownerId === ctx.userId);
}
