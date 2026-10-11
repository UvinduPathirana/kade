import { Inject, Injectable } from "@nestjs/common";
import {
  OutletServiceService,
  PaperWidth,
  type GetOutletRequest,
  type GetOutletResponse,
  type GetOutletSettingsRequest,
  type GetOutletSettingsResponse,
  type OutletSettings,
  type PauseOutletRequest,
  type PauseOutletResponse,
  type PrintTestTicketRequest,
  type PrintTestTicketResponse,
  type ReportTabletHeartbeatRequest,
  type ReportTabletHeartbeatResponse,
  type ResumeOutletRequest,
  type ResumeOutletResponse,
  type SetBusyModeRequest,
  type SetBusyModeResponse,
  type UpdateOutletSettingsRequest,
  type UpdateOutletSettingsResponse,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { actorOf } from "../domain/merchant-events.js";
import { BUSY_MODE_MINUTES, MINUTE } from "../domain/values.js";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { failedPrecondition, invalidArgument } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { OutletAccess } from "./outlet-access.js";
import { settingsFromJson, settingsToJson, toOutlet } from "./outlet-mapper.js";
import { OutletStatusUpdater } from "./outlet-status.js";
import { OutletsRepository } from "./outlets.repository.js";

/** Longest a kitchen can pause itself; beyond that ops should close the outlet. */
export const MAX_PAUSE_MS = 24 * 60 * MINUTE;

/** kade.merchant.v1.OutletService: the kitchen's own controls (busy, pause, tablet, settings). */
@GrpcService(OutletServiceService)
@Injectable()
export class OutletGrpcService implements GrpcHandlers<OutletServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OutletAccess) private readonly access: OutletAccess,
    @Inject(OutletsRepository) private readonly outlets: OutletsRepository,
    @Inject(OutletStatusUpdater) private readonly status: OutletStatusUpdater,
  ) {}

  async getOutlet(request: GetOutletRequest, ctx: RequestContext): Promise<GetOutletResponse> {
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    return { outlet: toOutlet(outlet, new Date()) };
  }

  async setBusyMode(request: SetBusyModeRequest, ctx: RequestContext): Promise<SetBusyModeResponse> {
    if (!(BUSY_MODE_MINUTES as readonly number[]).includes(request.busyExtraMinutes)) {
      throw invalidArgument("BUSY_MODE_INVALID", "Busy mode adds 0, 10 or 20 minutes.", {
        field: "busy_extra_minutes",
      });
    }
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    const row = await this.database.transaction(ctx, (tx) =>
      this.status.change(tx, outlet.id, actorOf(ctx, outlet.id), () => ({
        busyExtraMinutes: request.busyExtraMinutes,
      })),
    );
    return { outlet: toOutlet(row, new Date()) };
  }

  async pauseOutlet(request: PauseOutletRequest, ctx: RequestContext): Promise<PauseOutletResponse> {
    const now = new Date();
    const until = request.until;
    if (!until || until.getTime() <= now.getTime()) {
      throw invalidArgument("PAUSE_UNTIL_INVALID", "Choose a time in the future.", { field: "until" });
    }
    if (until.getTime() - now.getTime() > MAX_PAUSE_MS) {
      throw invalidArgument("PAUSE_TOO_LONG", "You can pause for up to 24 hours.", { field: "until" });
    }
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    const row = await this.database.transaction(ctx, (tx) =>
      this.status.change(tx, outlet.id, actorOf(ctx, outlet.id), () => ({ pausedUntil: until }), now),
    );
    return { outlet: toOutlet(row, now) };
  }

  async resumeOutlet(request: ResumeOutletRequest, ctx: RequestContext): Promise<ResumeOutletResponse> {
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    const row = await this.database.transaction(ctx, (tx) =>
      this.status.change(tx, outlet.id, actorOf(ctx, outlet.id), () => ({ pausedUntil: null })),
    );
    return { outlet: toOutlet(row, new Date()) };
  }

  async reportTabletHeartbeat(
    request: ReportTabletHeartbeatRequest,
    ctx: RequestContext,
  ): Promise<ReportTabletHeartbeatResponse> {
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    const now = new Date();
    await this.database.transaction(ctx, (tx) =>
      this.status.change(
        tx,
        outlet.id,
        actorOf(ctx, outlet.id),
        () => ({ lastHeartbeatAt: now, tabletDeviceId: request.deviceId || outlet.tabletDeviceId }),
        now,
      ),
    );
    return {};
  }

  async getOutletSettings(
    request: GetOutletSettingsRequest,
    ctx: RequestContext,
  ): Promise<GetOutletSettingsResponse> {
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    return { settings: settingsFromJson(outlet.settings) };
  }

  async updateOutletSettings(
    request: UpdateOutletSettingsRequest,
    ctx: RequestContext,
  ): Promise<UpdateOutletSettingsResponse> {
    const settings = validateSettings(request.settings);
    const { outlet } = await this.access.authorise(ctx, request.outletId, "manager");
    const row = await this.database.transaction(ctx, (tx) =>
      this.outlets.update(tx, outlet.id, { settings: settingsToJson(settings) }),
    );
    return { settings: settingsFromJson(row.settings) };
  }

  async printTestTicket(
    request: PrintTestTicketRequest,
    ctx: RequestContext,
  ): Promise<PrintTestTicketResponse> {
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    const printer = settingsFromJson(outlet.settings).devices?.printerName.trim();
    if (!printer) {
      throw failedPrecondition("PRINTER_NOT_PAIRED", "Pair a printer with this tablet first.");
    }
    // No print service yet: the tablet prints locally; this confirms where the sample goes.
    return { message: `Sent to ${printer}` };
  }
}

export function validateSettings(input: OutletSettings | undefined): OutletSettings {
  const devices = input?.devices;
  const notifications = input?.notifications;
  if (!devices || !notifications) {
    throw invalidArgument("SETTINGS_REQUIRED", "Send both device and notification settings.", {
      field: "settings",
    });
  }
  if (devices.copies !== 1 && devices.copies !== 2) {
    throw invalidArgument("PRINT_COPIES_INVALID", "Print 1 or 2 copies.", {
      field: "settings.devices.copies",
    });
  }
  if (
    devices.paperWidth !== PaperWidth.PAPER_WIDTH_58MM &&
    devices.paperWidth !== PaperWidth.PAPER_WIDTH_80MM
  ) {
    throw invalidArgument("PAPER_WIDTH_INVALID", "Paper is 58 mm or 80 mm.", {
      field: "settings.devices.paper_width",
    });
  }
  const printerName = devices.printerName.trim();
  if (printerName.length > 80) {
    throw invalidArgument("PRINTER_NAME_TOO_LONG", "Keep the printer name under 80 characters.", {
      field: "settings.devices.printer_name",
    });
  }
  return { devices: { ...devices, printerName }, notifications: { ...notifications } };
}
