import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ProofKind } from "@kade/proto/kade/dispatch/v1/dispatch_service";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import type { LocationForwarder } from "../location.js";
import { toGeoPoint } from "../map.js";
import { fromRupees } from "../money.js";
import { toJob, toOffer, toTrip } from "../mappers.js";
import { MapPoint, Offer, Trip, problems, ref } from "../schemas.js";
import { IdempotencyHeaders, RIDER, idempotencyKey, riderOf, security, type RouteDeps } from "./context.js";

/**
 * The shift: availability, offers (polled; pushed over /ws when realtime runs), the active job's
 * steps, and GPS forwarding to location. Job ids are dispatch delivery ids.
 */
export const dispatchRoutes =
  ({ u, callContext, location }: RouteDeps & { location: LocationForwarder }): FastifyPluginAsyncTypebox =>
  async (app) => {
    const config = { roles: RIDER };
    const tags = ["dispatch"];
    const idParams = Type.Object({ id: Type.String({ minLength: 1 }) });
    const at = Type.Object({ at: Type.Number({ description: "Epoch ms recorded by dispatch." }) });

    app.post(
      "/v1/availability",
      {
        config,
        schema: {
          operationId: "setAvailability",
          tags,
          security,
          summary: "Go online (with the rider's position) or offline",
          body: Type.Object({ online: Type.Boolean(), position: Type.Optional(ref(MapPoint)) }),
          response: {
            200: Type.Object({ online: Type.Boolean(), cashAllowed: Type.Boolean() }),
            ...problems(400, 401, 403, 503, 504),
          },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.setAvailability.bind(u.dispatch),
          {
            riderId: riderOf(req),
            online: req.body.online,
            position: req.body.position ? toGeoPoint(req.body.position) : undefined,
          },
          callContext(req, reply),
        );
        return { online: req.body.online, cashAllowed: res.cashAllowed };
      },
    );

    app.get(
      "/v1/offer",
      {
        config,
        schema: {
          operationId: "getCurrentOffer",
          tags,
          security,
          summary: "The open offer for this rider; 204 when there is none (poll every few seconds)",
          response: {
            200: ref(Offer),
            204: { type: "null", description: "No offer right now" },
            ...problems(401, 403, 503, 504),
          },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.getCurrentOffer.bind(u.dispatch),
          { riderId: riderOf(req) },
          callContext(req, reply),
        );
        const offer = res.offer;
        if (!offer?.delivery || (offer.expiresAt && offer.expiresAt.getTime() <= Date.now())) {
          return reply.code(204).send(null);
        }
        return toOffer(offer);
      },
    );

    app.get(
      "/v1/job",
      {
        config,
        schema: {
          operationId: "getActiveJob",
          tags,
          security,
          summary: "The rider's active job; 204 when there is none",
          response: { 200: ref(Offer), 204: { type: "null" }, ...problems(401, 403, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.getActiveJob.bind(u.dispatch),
          { riderId: riderOf(req) },
          callContext(req, reply),
        );
        if (!res.delivery) return reply.code(204).send(null);
        return toJob(res.delivery);
      },
    );

    app.post(
      "/v1/offers/:id/accept",
      {
        config,
        schema: {
          operationId: "acceptOffer",
          tags,
          security,
          summary: "Accept an offer; answers with the job (id = delivery id)",
          headers: IdempotencyHeaders,
          params: idParams,
          response: { 200: ref(Offer), ...problems(400, 401, 403, 404, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.acceptOffer.bind(u.dispatch),
          { riderId: riderOf(req), offerId: req.params.id, idempotencyKey: idempotencyKey(req) },
          callContext(req, reply),
        );
        return toJob(res.delivery);
      },
    );

    app.post(
      "/v1/offers/:id/decline",
      {
        config,
        schema: {
          operationId: "declineOffer",
          tags,
          security,
          params: idParams,
          body: Type.Object({ reason: Type.Optional(Type.String({ maxLength: 120 })) }),
          response: { 204: { type: "null" }, ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        await unary(
          u.dispatch.declineOffer.bind(u.dispatch),
          { riderId: riderOf(req), offerId: req.params.id, reason: req.body.reason ?? "" },
          callContext(req, reply),
        );
        return reply.code(204).send(null);
      },
    );

    const step = { config, schema: { tags, security, headers: IdempotencyHeaders, params: idParams } };

    app.post(
      "/v1/jobs/:id/arrived-restaurant",
      {
        ...step,
        schema: {
          ...step.schema,
          operationId: "arriveAtRestaurant",
          summary: "Records arrival so waiting time can be paid",
          response: { 200: at, ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.arriveAtRestaurant.bind(u.dispatch),
          { riderId: riderOf(req), deliveryId: req.params.id, idempotencyKey: idempotencyKey(req) },
          callContext(req, reply),
        );
        return { at: res.delivery?.arrivedAtRestaurantAt?.getTime() ?? Date.now() };
      },
    );

    app.post(
      "/v1/jobs/:id/not-ready",
      {
        ...step,
        schema: {
          ...step.schema,
          operationId: "reportNotReady",
          summary: "The food isn't ready: answers with the kitchen's estimate",
          response: {
            200: Type.Object({ readyAt: Type.Number() }),
            ...problems(400, 401, 403, 404, 503, 504),
          },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.reportFoodNotReady.bind(u.dispatch),
          { riderId: riderOf(req), deliveryId: req.params.id },
          callContext(req, reply),
        );
        return { readyAt: res.readyAt?.getTime() ?? Date.now() + 3 * 60_000 };
      },
    );

    app.post(
      "/v1/jobs/:id/picked-up",
      {
        ...step,
        schema: {
          ...step.schema,
          operationId: "confirmPickup",
          summary: "Every item ticked, or the bag sealed",
          body: Type.Object({ checkedItems: Type.Array(Type.String()), sealed: Type.Boolean() }),
          response: { 200: at, ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.confirmPickup.bind(u.dispatch),
          {
            riderId: riderOf(req),
            deliveryId: req.params.id,
            checkedItemIds: req.body.checkedItems,
            sealed: req.body.sealed,
            idempotencyKey: idempotencyKey(req),
          },
          callContext(req, reply),
        );
        return { at: res.delivery?.pickedUpAt?.getTime() ?? Date.now() };
      },
    );

    app.post(
      "/v1/jobs/:id/arrived-customer",
      {
        ...step,
        schema: {
          ...step.schema,
          operationId: "arriveAtCustomer",
          response: { 200: at, ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.arriveAtCustomer.bind(u.dispatch),
          { riderId: riderOf(req), deliveryId: req.params.id, idempotencyKey: idempotencyKey(req) },
          callContext(req, reply),
        );
        return { at: res.delivery?.arrivedAtCustomerAt?.getTime() ?? Date.now() };
      },
    );

    app.post(
      "/v1/jobs/:id/complete",
      {
        ...step,
        schema: {
          ...step.schema,
          operationId: "completeDelivery",
          summary: "Proof (code or photo) and cash collected; answers with the trip",
          body: Type.Object({
            proof: Type.Union([Type.Literal("code"), Type.Literal("photo")]),
            code: Type.Optional(Type.String({ maxLength: 12 })),
            fileName: Type.Optional(Type.String({ maxLength: 200 })),
            cashCollected: Type.Integer({ minimum: 0, description: "Whole rupees." }),
          }),
          response: { 200: ref(Trip), ...problems(400, 401, 403, 404, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const photo = req.body.proof === "photo";
        const res = await unary(
          u.dispatch.completeDelivery.bind(u.dispatch),
          {
            riderId: riderOf(req),
            deliveryId: req.params.id,
            proof: photo ? ProofKind.PROOF_KIND_PHOTO : ProofKind.PROOF_KIND_CODE,
            code: photo ? "" : (req.body.code ?? "").trim(),
            // Uploads come with an object store; until then the file name stands in for the ref.
            photoRef: photo ? (req.body.fileName ?? "photo") : "",
            cashCollected: fromRupees(req.body.cashCollected),
            idempotencyKey: idempotencyKey(req),
          },
          callContext(req, reply),
        );
        return toTrip(res.trip);
      },
    );

    app.post(
      "/v1/jobs/:id/messages",
      {
        ...step,
        schema: {
          ...step.schema,
          operationId: "messageCustomer",
          summary: "Quick reply to the customer through masked messaging",
          body: Type.Object({ text: Type.String({ minLength: 1, maxLength: 300 }) }),
          response: { 204: { type: "null" }, ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        await unary(
          u.dispatch.sendCustomerMessage.bind(u.dispatch),
          { riderId: riderOf(req), deliveryId: req.params.id, text: req.body.text },
          callContext(req, reply),
        );
        return reply.code(204).send(null);
      },
    );

    app.post(
      "/v1/location",
      {
        config,
        schema: {
          operationId: "reportLocation",
          tags,
          security,
          summary: "GPS fixes (lat/lng) or a map position; streamed to the location service",
          body: Type.Object({
            fixes: Type.Array(
              Type.Object({
                lat: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
                lng: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
                point: Type.Optional(ref(MapPoint)),
                heading: Type.Optional(Type.Number()),
                speedMps: Type.Optional(Type.Number({ minimum: 0 })),
                accuracyM: Type.Optional(Type.Number({ minimum: 0 })),
                at: Type.Optional(Type.Number()),
                jobId: Type.Optional(Type.String()),
              }),
              { minItems: 1, maxItems: 50 },
            ),
          }),
          response: {
            202: Type.Object({ forwarded: Type.Integer(), dropped: Type.Integer() }),
            ...problems(400, 401, 403),
          },
        },
      },
      async (req, reply) => {
        const riderId = riderOf(req);
        let forwarded = 0;
        for (const f of req.body.fixes) {
          const geo =
            f.lat !== undefined && f.lng !== undefined
              ? { lat: f.lat, lng: f.lng }
              : f.point
                ? toGeoPoint(f.point)
                : undefined;
          if (!geo) continue;
          const ok = location.send(req.identity!, riderId, {
            ...geo,
            heading: f.heading,
            speedMps: f.speedMps,
            accuracyM: f.accuracyM,
            at: f.at,
            deliveryId: f.jobId,
          });
          if (ok) forwarded++;
        }
        return reply.code(202).send({ forwarded, dropped: req.body.fixes.length - forwarded });
      },
    );
  };
