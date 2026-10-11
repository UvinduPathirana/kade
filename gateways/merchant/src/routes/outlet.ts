import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Restaurant } from "@kade/proto/kade/catalog/v1/catalog_service";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import { fromDayHours, toOutlet } from "../mappers.js";
import { DayHours, Outlet, problems, ref } from "../schemas.js";
import { STAFF, outletOf, security, type RouteDeps } from "./context.js";

/**
 * The outlet as the app sees it: busy mode and pause from merchant, name/address/phone from catalog
 * (falling back to merchant's copy), hours and closures from catalog. Every change answers with
 * the whole outlet.
 */
export const outletRoutes =
  ({ u, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const config = { roles: STAFF };
    const tags = ["outlet"];
    const answers = { 200: ref(Outlet), ...problems(400, 401, 403, 404, 503, 504) };

    const read = async (req: FastifyRequest, reply: FastifyReply) => {
      const outletId = outletOf(req);
      const ctx = callContext(req, reply);
      const [outlet, hours, details] = await Promise.all([
        unary(u.outlets.getOutlet.bind(u.outlets), { outletId }, ctx),
        unary(u.restaurants.getOpeningHours.bind(u.restaurants), { restaurantId: outletId }, ctx),
        // Details are a nicety (merchant has a copy): never fail the page over them.
        unary(u.catalog.getRestaurant.bind(u.catalog), { id: outletId, deliverTo: undefined }, ctx).then(
          (r) => r.restaurant,
          (err: unknown): Restaurant | undefined => {
            req.log.debug({ err }, "catalog GetRestaurant failed; using merchant details");
            return undefined;
          },
        ),
      ]);
      return toOutlet(outlet.outlet, details, hours.hours, hours.closures);
    };

    app.get(
      "/v1/outlet",
      {
        config,
        schema: {
          operationId: "getOutlet",
          tags,
          security,
          summary: "Status, details, hours",
          response: answers,
        },
      },
      read,
    );

    app.put(
      "/v1/outlet/busy",
      {
        config,
        schema: {
          operationId: "setBusy",
          tags,
          security,
          summary: "Busy mode: extra prep minutes on every order",
          body: Type.Object({ busyExtra: Type.Union([Type.Literal(0), Type.Literal(10), Type.Literal(20)]) }),
          response: answers,
        },
      },
      async (req, reply) => {
        await unary(
          u.outlets.setBusyMode.bind(u.outlets),
          { outletId: outletOf(req), busyExtraMinutes: req.body.busyExtra },
          callContext(req, reply),
        );
        return read(req, reply);
      },
    );

    app.put(
      "/v1/outlet/pause",
      {
        config,
        schema: {
          operationId: "setPause",
          tags,
          security,
          summary: "Pause new orders until a time (epoch ms); null resumes now",
          body: Type.Object({ until: Type.Union([Type.Number(), Type.Null()]) }),
          response: answers,
        },
      },
      async (req, reply) => {
        const outletId = outletOf(req);
        const until = req.body.until;
        if (until === null || until <= Date.now()) {
          await unary(u.outlets.resumeOutlet.bind(u.outlets), { outletId }, callContext(req, reply));
        } else {
          await unary(
            u.outlets.pauseOutlet.bind(u.outlets),
            { outletId, until: new Date(until) },
            callContext(req, reply),
          );
        }
        return read(req, reply);
      },
    );

    app.put(
      "/v1/outlet/hours",
      {
        config,
        schema: {
          operationId: "saveHours",
          tags,
          security,
          summary: "Replaces the weekly hours (all seven days)",
          body: Type.Object({ hours: Type.Array(ref(DayHours), { minItems: 7, maxItems: 7 }) }),
          response: answers,
        },
      },
      async (req, reply) => {
        await unary(
          u.restaurants.setOpeningHours.bind(u.restaurants),
          { restaurantId: outletOf(req), hours: req.body.hours.map(fromDayHours) },
          callContext(req, reply),
        );
        return read(req, reply);
      },
    );

    app.post(
      "/v1/outlet/closures",
      {
        config,
        schema: {
          operationId: "addClosure",
          tags,
          security,
          summary: "Special closure for a whole day",
          body: Type.Object({
            date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
            reason: Type.String({ maxLength: 120 }),
          }),
          response: answers,
        },
      },
      async (req, reply) => {
        await unary(
          u.restaurants.addClosure.bind(u.restaurants),
          { restaurantId: outletOf(req), date: req.body.date, reason: req.body.reason },
          callContext(req, reply),
        );
        return read(req, reply);
      },
    );

    app.delete(
      "/v1/outlet/closures/:id",
      {
        config,
        schema: {
          operationId: "removeClosure",
          tags,
          security,
          summary: "Removes a special closure",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          response: answers,
        },
      },
      async (req, reply) => {
        await unary(
          u.restaurants.removeClosure.bind(u.restaurants),
          { restaurantId: outletOf(req), closureId: req.params.id },
          callContext(req, reply),
        );
        return read(req, reply);
      },
    );

    app.put(
      "/v1/outlet/details",
      {
        config,
        schema: {
          operationId: "saveDetails",
          tags,
          security,
          summary: "Name, address and phone customers see",
          body: Type.Object({
            name: Type.String({ minLength: 1, maxLength: 120 }),
            address: Type.String({ maxLength: 200 }),
            phone: Type.String({ maxLength: 40 }),
          }),
          response: answers,
        },
      },
      async (req, reply) => {
        const restaurantId = outletOf(req);
        const ctx = callContext(req, reply);
        // UpdateRestaurantDetails replaces every detail: start from what catalog has.
        const current = (
          await unary(
            u.catalog.getRestaurant.bind(u.catalog),
            { id: restaurantId, deliverTo: undefined },
            ctx,
          )
        ).restaurant;
        await unary(
          u.restaurants.updateRestaurantDetails.bind(u.restaurants),
          {
            restaurantId,
            details: {
              name: req.body.name.trim(),
              kind: current?.kind ?? 1,
              categoryId: current?.categoryId ?? "",
              cuisine: current?.cuisine ?? "",
              imageId: current?.imageId ?? "",
              priceLevel: current?.priceLevel ?? 0,
              area: current?.area ?? "",
              address: req.body.address.trim(),
              phone: req.body.phone.trim(),
              location: current?.location,
              prepMinMinutes: 0,
              prepMaxMinutes: 0,
            },
          },
          ctx,
        );
        return read(req, reply);
      },
    );
  };
