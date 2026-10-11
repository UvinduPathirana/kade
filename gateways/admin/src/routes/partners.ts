import { randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ApplicationStatus } from "@kade/proto/kade/common/v1/onboarding";
import {
  DecideRiderApplicationRequest,
  ListRiderApplicationsRequest,
  ListRidersRequest,
  ReviewRiderDocumentRequest,
  SetRiderSuspendedRequest,
  SetRiderZonesRequest,
  type RiderApplication as ProtoRiderApplication,
} from "@kade/proto/kade/dispatch/v1/dispatch_service";
import {
  DecideApplicationRequest,
  GetOutletAdminRequest,
  ListApplicationsRequest,
  SetApplicationDocumentStatusRequest,
  SetOutletStatusRequest,
  UpdateCommissionRequest,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { Type } from "typebox";
import { badRequest, notFound, type Ctx } from "../context.js";
import { personId, personUuid, restaurantUuid } from "../ids.js";
import { allPages, PAGE, soft } from "../lib.js";
import {
  DECISION_TO_PROTO,
  DOC_STATUS_TO_PROTO,
  OUTLET_STATUS_TO_PROTO,
  toRestaurant,
  toRestaurantApplication,
  toRider,
  toRiderApplication,
  toZone,
} from "../mappers/partners.js";
import {
  listOf,
  problems,
  ref,
  Restaurant,
  RESTAURANT_STATUSES,
  RestaurantApplication,
  Rider,
  RiderApplication,
  Zone,
} from "../schemas.js";

const security = [{ bearer: [] }];
const Decision = Type.Union([
  Type.Literal("approved"),
  Type.Literal("changesRequested"),
  Type.Literal("rejected"),
]);
const DocStatus = Type.Union([Type.Literal("pending"), Type.Literal("approved"), Type.Literal("rejected")]);
const RestaurantParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });

async function listRiderApplications(ctx: Ctx): Promise<ProtoRiderApplication[]> {
  return allPages(async (pageToken) => {
    const res = await ctx.rpc(
      ctx.up.riders,
      "listRiderApplications",
      ListRiderApplicationsRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
    );
    return { items: res.applications, next: res.page?.nextPageToken ?? "" };
  });
}

export const partnerRoutes =
  (opts: { invalidateOutlets: () => void }): FastifyPluginAsyncTypebox =>
  async (app) => {
    /* ---------- Restaurants (merchant) ---------- */

    app.get(
      "/v1/restaurants",
      {
        schema: {
          operationId: "listRestaurants",
          tags: ["restaurants"],
          security,
          summary: "Every restaurant with orders/week, acceptance, commission and status (merchant).",
          response: { 200: listOf(Restaurant), ...problems(401, 403, 503, 504) },
        },
      },
      async (req) => {
        opts.invalidateOutlets();
        return (await req.ctx.outlets()).map(toRestaurant);
      },
    );

    app.get(
      "/v1/restaurant-applications",
      {
        schema: {
          operationId: "listRestaurantApplications",
          tags: ["restaurants"],
          security,
          summary: "Restaurant onboarding review queue (merchant).",
          response: { 200: listOf(RestaurantApplication), ...problems(401, 403, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const apps = await allPages(async (pageToken) => {
          const res = await ctx.rpc(
            ctx.up.applications,
            "listApplications",
            ListApplicationsRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
          );
          return { items: res.applications, next: res.page?.nextPageToken ?? "" };
        });
        return apps.map(toRestaurantApplication);
      },
    );

    app.post(
      "/v1/restaurant-applications/:id/decision",
      {
        config: { permission: "partners.approve" },
        schema: {
          operationId: "decideRestaurantApplication",
          tags: ["restaurants"],
          security,
          summary: "Approve (creates the outlet), request changes or reject. Audited.",
          params: IdParams,
          body: Type.Object({ decision: Decision, note: Type.String({ maxLength: 1000 }) }),
          response: { 200: ref(RestaurantApplication), ...problems(400, 401, 403, 404, 409, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const { decision, note } = req.body;
        const res = await ctx.rpc(
          ctx.up.applications,
          "decideApplication",
          DecideApplicationRequest.fromPartial({
            applicationId: req.params.id,
            decision: DECISION_TO_PROTO[decision],
            note,
            idempotencyKey: randomUUID(),
          }),
        );
        if (!res.application) throw notFound("Application");
        const a = toRestaurantApplication(res.application);
        const verb = { approved: "Approved", changesRequested: "Requested changes to", rejected: "Rejected" }[
          decision
        ];
        await ctx.audit({
          action: `${verb} restaurant application`,
          recordType: "restaurant",
          recordId: a.id,
          detail: note || a.name,
        });
        opts.invalidateOutlets();
        return a;
      },
    );

    app.post(
      "/v1/restaurant-applications/:id/documents/:docId",
      {
        config: { permission: "partners.approve" },
        schema: {
          operationId: "setRestaurantDocStatus",
          tags: ["restaurants"],
          security,
          summary: "Approve or reject one onboarding document.",
          params: Type.Object({ id: Type.String({ minLength: 1 }), docId: Type.String({ minLength: 1 }) }),
          body: Type.Object({ status: DocStatus, reason: Type.Optional(Type.String({ maxLength: 500 })) }),
          response: { 200: ref(RestaurantApplication), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const res = await ctx.rpc(
          ctx.up.applications,
          "setApplicationDocumentStatus",
          SetApplicationDocumentStatusRequest.fromPartial({
            applicationId: req.params.id,
            documentId: req.params.docId,
            status: DOC_STATUS_TO_PROTO[req.body.status],
            rejectReason: req.body.reason ?? "",
          }),
        );
        if (!res.application) throw notFound("Application");
        return toRestaurantApplication(res.application);
      },
    );

    app.put(
      "/v1/restaurants/:id/commission",
      {
        config: { permission: "partners.commission" },
        schema: {
          operationId: "updateCommission",
          tags: ["restaurants"],
          security,
          summary: "Commission percent, 0–35 (merchant). Audited.",
          params: RestaurantParams,
          body: Type.Object({ commission: Type.Number() }),
          response: { 200: ref(Restaurant), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const { commission } = req.body;
        if (!Number.isFinite(commission) || commission < 0 || commission > 35)
          throw badRequest("COMMISSION_OUT_OF_RANGE", "Commission must be between 0% and 35%.");
        const outletId = restaurantUuid(req.params.id);
        const before = await soft(
          ctx.log,
          "commission before",
          ctx.rpc(ctx.up.outlets, "getOutletAdmin", GetOutletAdminRequest.fromPartial({ outletId })),
          undefined,
        );
        const res = await ctx.rpc(
          ctx.up.outlets,
          "updateCommission",
          UpdateCommissionRequest.fromPartial({ outletId, commissionBps: Math.round(commission * 100) }),
        );
        if (!res.outlet) throw notFound("Restaurant");
        const r = toRestaurant(res.outlet);
        const was = before?.outlet?.outlet ? `${before.outlet.outlet.commissionBps / 100}%` : "the old rate";
        await ctx.audit({
          action: `Changed commission from ${was} to ${commission}%`,
          recordType: "restaurant",
          recordId: String(r.id),
          detail: r.name,
        });
        opts.invalidateOutlets();
        return r;
      },
    );

    app.put(
      "/v1/restaurants/:id/status",
      {
        config: { permission: "partners.suspend" },
        schema: {
          operationId: "setRestaurantStatus",
          tags: ["restaurants"],
          security,
          summary: "Open, pause, suspend or close a restaurant with a reason (merchant). Audited.",
          params: RestaurantParams,
          body: Type.Object({
            status: Type.Enum(RESTAURANT_STATUSES),
            reason: Type.String({ maxLength: 500 }),
          }),
          response: { 200: ref(Restaurant), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const { status, reason } = req.body;
        const res = await ctx.rpc(
          ctx.up.outlets,
          "setOutletStatus",
          SetOutletStatusRequest.fromPartial({
            outletId: restaurantUuid(req.params.id),
            status: OUTLET_STATUS_TO_PROTO[status],
            reason,
          }),
        );
        if (!res.outlet) throw notFound("Restaurant");
        const r = toRestaurant(res.outlet);
        const verb = { open: "Reopened", paused: "Paused", suspended: "Suspended", closed: "Closed" }[status];
        await ctx.audit({
          action: `${verb} restaurant`,
          recordType: "restaurant",
          recordId: String(r.id),
          detail: reason || r.name,
        });
        opts.invalidateOutlets();
        return r;
      },
    );

    /* ---------- Riders (dispatch) and zones (pricing) ---------- */

    app.get(
      "/v1/riders",
      {
        schema: {
          operationId: "listRiders",
          tags: ["riders"],
          security,
          summary: "The rider fleet with status, cash held and position (dispatch).",
          response: { 200: listOf(Rider), ...problems(401, 403, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const [riders, zones] = await Promise.all([
          allPages(async (pageToken) => {
            const res = await ctx.rpc(
              ctx.up.riders,
              "listRiders",
              ListRidersRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
            );
            return { items: res.riders, next: res.page?.nextPageToken ?? "" };
          }),
          soft(ctx.log, "zones", ctx.zones(), []),
        ]);
        return riders.map((r) => toRider(r, zones));
      },
    );

    app.get(
      "/v1/rider-applications",
      {
        schema: {
          operationId: "listRiderApplications",
          tags: ["riders"],
          security,
          summary: "Rider onboarding review queue (dispatch).",
          response: { 200: listOf(RiderApplication), ...problems(401, 403, 503, 504) },
        },
      },
      async (req) => (await listRiderApplications(req.ctx)).map(toRiderApplication),
    );

    app.get(
      "/v1/zones",
      {
        schema: {
          operationId: "listZones",
          tags: ["riders", "pricing"],
          security,
          summary: "Delivery zones and their fees (pricing).",
          response: { 200: listOf(Zone), ...problems(401, 403, 503, 504) },
        },
      },
      async (req) => (await req.ctx.zones()).map(toZone),
    );

    app.post(
      "/v1/rider-applications/:id/documents/:docId",
      {
        config: { permission: "partners.approve" },
        schema: {
          operationId: "reviewRiderDoc",
          tags: ["riders"],
          security,
          summary: "Approve or reject one rider document (dispatch). Audited.",
          params: Type.Object({ id: Type.String({ minLength: 1 }), docId: Type.String({ minLength: 1 }) }),
          body: Type.Object({ status: DocStatus, reason: Type.Optional(Type.String({ maxLength: 500 })) }),
          response: { 200: ref(RiderApplication), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const { status, reason } = req.body;
        await ctx.rpc(
          ctx.up.riders,
          "reviewRiderDocument",
          ReviewRiderDocumentRequest.fromPartial({
            applicationId: req.params.id,
            documentId: req.params.docId,
            status: DOC_STATUS_TO_PROTO[status],
            rejectReason: status === "rejected" ? (reason ?? "") : "",
          }),
        );
        const found = (await listRiderApplications(ctx)).find((a) => a.id === req.params.id);
        if (!found) throw notFound("Application");
        const a = toRiderApplication(found);
        const d = a.documents.find((x) => x.id === req.params.docId);
        const kind = (d?.kind ?? "document").toLowerCase();
        await ctx.audit({
          action: status === "approved" ? `Approved ${kind}` : `Rejected ${kind}`,
          recordType: "rider",
          recordId: a.id,
          detail: status === "rejected" ? reason : a.name,
        });
        return a;
      },
    );

    app.post(
      "/v1/rider-applications/:id/decision",
      {
        config: { permission: "partners.approve" },
        schema: {
          operationId: "decideRiderApplication",
          tags: ["riders"],
          security,
          summary: "Approve (every document approved first), ask for new documents or reject. Audited.",
          params: IdParams,
          body: Type.Object({ decision: Decision, note: Type.String({ maxLength: 1000 }) }),
          response: { 200: ref(RiderApplication), ...problems(400, 401, 403, 404, 409, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const { decision, note } = req.body;
        const res = await ctx.rpc(
          ctx.up.riders,
          "decideRiderApplication",
          DecideRiderApplicationRequest.fromPartial({
            applicationId: req.params.id,
            decision: DECISION_TO_PROTO[decision],
            note,
            idempotencyKey: randomUUID(),
          }),
        );
        if (!res.application) throw notFound("Application");
        const a = toRiderApplication(res.application);
        const verb = {
          approved: "Approved",
          changesRequested: "Asked for new documents from",
          rejected: "Rejected",
        }[decision];
        await ctx.audit({
          action: `${verb} rider applicant`,
          recordType: "rider",
          recordId: a.id,
          detail: note || a.name,
        });
        return a;
      },
    );

    app.put(
      "/v1/riders/:id/zones",
      {
        config: { permission: ["partners.approve", "partners.suspend"] },
        schema: {
          operationId: "setRiderZones",
          tags: ["riders"],
          security,
          summary: "Zones the rider works in, at least one (dispatch). Audited.",
          params: IdParams,
          body: Type.Object({ zoneIds: Type.Array(Type.String(), { maxItems: 40 }) }),
          response: { 200: ref(Rider), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const { zoneIds } = req.body;
        if (zoneIds.length === 0) throw badRequest("ZONES_REQUIRED", "Choose at least one zone.");
        const res = await ctx.rpc(
          ctx.up.riders,
          "setRiderZones",
          SetRiderZonesRequest.fromPartial({ riderId: personUuid(req.params.id), zoneIds }),
        );
        if (!res.rider) throw notFound("Rider");
        const zones = await soft(ctx.log, "zones", ctx.zones(), []);
        const codes = zoneIds.map((z) => zones.find((x) => x.id === z)?.code ?? z).join(", ");
        await ctx.audit({
          action: "Changed rider zones",
          recordType: "rider",
          recordId: personId(res.rider.id),
          detail: codes,
        });
        return toRider(res.rider, zones);
      },
    );

    app.put(
      "/v1/riders/:id/suspension",
      {
        config: { permission: "partners.suspend" },
        schema: {
          operationId: "setRiderSuspended",
          tags: ["riders"],
          security,
          summary: "Suspend or reinstate a rider with a reason (dispatch). Audited.",
          params: IdParams,
          body: Type.Object({ suspended: Type.Boolean(), reason: Type.String({ maxLength: 500 }) }),
          response: { 200: ref(Rider), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const { suspended, reason } = req.body;
        const res = await ctx.rpc(
          ctx.up.riders,
          "setRiderSuspended",
          SetRiderSuspendedRequest.fromPartial({ riderId: personUuid(req.params.id), suspended, reason }),
        );
        if (!res.rider) throw notFound("Rider");
        await ctx.audit({
          action: suspended ? "Suspended rider" : "Reinstated rider",
          recordType: "rider",
          recordId: personId(res.rider.id),
          detail: reason || res.rider.name,
        });
        return toRider(res.rider, await soft(ctx.log, "zones", ctx.zones(), []));
      },
    );
  };

export { ApplicationStatus };
