import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { EarningsPeriod } from "@kade/proto/kade/ledger/v1/ledger_service";
import { Thumb } from "@kade/proto/kade/review/v1/review_service";
import { status } from "@grpc/grpc-js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { isServiceError, unary } from "../grpc/call.js";
import {
  type Period as PeriodName,
  cashFromRider,
  earningsFromTrips,
  periodStart,
  toCash,
  toDocument,
  toEarnings,
  toPayout,
  toProfile,
  toQuest,
  toRatings,
  toTrip,
} from "../mappers.js";
import {
  CashBalance,
  EarningsSummary,
  Payout,
  Period,
  Quest,
  RatingsSummary,
  RiderDocument,
  RiderProfile,
  TodaySummary,
  Trip,
  problems,
  ref,
} from "../schemas.js";
import { RIDER, riderOf, security, type RouteDeps } from "./context.js";

const PERIODS = {
  today: EarningsPeriod.EARNINGS_PERIOD_TODAY,
  week: EarningsPeriod.EARNINGS_PERIOD_WEEK,
  month: EarningsPeriod.EARNINGS_PERIOD_MONTH,
} as const;

const thumb = (t: "up" | "down" | undefined) =>
  t === "up" ? Thumb.THUMB_UP : t === "down" ? Thumb.THUMB_DOWN : Thumb.THUMB_UNSPECIFIED;

/** Ledger not running (or not answering): the money screens fall back to dispatch's own figures. */
const ledgerDown = (err: unknown) =>
  isServiceError(err) &&
  [status.UNAVAILABLE, status.UNIMPLEMENTED, status.DEADLINE_EXCEEDED].includes(err.code);

/** Profile, documents, trips and ratings (dispatch, review); earnings, cash, payouts (ledger). */
export const accountRoutes =
  ({ u, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const config = { roles: RIDER };
    const fail = problems(401, 403, 503, 504);

    /** Earnings computed from dispatch's delivered trips, for when ledger can't answer. */
    const tripEarnings = async (req: FastifyRequest, reply: FastifyReply, period: PeriodName) => {
      const res = await unary(
        u.dispatch.listTrips.bind(u.dispatch),
        {
          riderId: riderOf(req),
          from: periodStart(period),
          to: undefined,
          page: { pageSize: 500, pageToken: "" },
        },
        callContext(req, reply),
      );
      return earningsFromTrips(res.trips, period);
    };
    const earnings = async (req: FastifyRequest, reply: FastifyReply, period: PeriodName) => {
      try {
        const res = await unary(
          u.finance.getRiderEarnings.bind(u.finance),
          { riderId: riderOf(req), period: PERIODS[period] },
          callContext(req, reply),
        );
        return res.summary;
      } catch (err) {
        if (!ledgerDown(err)) throw err;
        req.log.debug({ err }, "ledger unavailable; earnings from dispatch trips");
        return tripEarnings(req, reply, period);
      }
    };

    app.get(
      "/v1/profile",
      {
        config,
        schema: {
          operationId: "getProfile",
          tags: ["rider"],
          security,
          response: { 200: ref(RiderProfile), ...fail },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.riders.getRiderProfile.bind(u.riders),
          { riderId: riderOf(req) },
          callContext(req, reply),
        );
        return toProfile(res.rider);
      },
    );

    app.get(
      "/v1/documents",
      {
        config,
        schema: {
          operationId: "listDocuments",
          tags: ["rider"],
          security,
          response: { 200: Type.Array(ref(RiderDocument)), ...fail },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.riders.listRiderDocuments.bind(u.riders),
          { riderId: riderOf(req) },
          callContext(req, reply),
        );
        return res.documents.map(toDocument);
      },
    );

    app.get(
      "/v1/trips",
      {
        config,
        schema: {
          operationId: "listTrips",
          tags: ["rider"],
          security,
          summary: "Trip history, newest first (last 60 days)",
          response: { 200: Type.Array(ref(Trip)), ...fail },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.listTrips.bind(u.dispatch),
          {
            riderId: riderOf(req),
            from: new Date(Date.now() - 60 * 86_400_000),
            to: undefined,
            page: { pageSize: 500, pageToken: "" },
          },
          callContext(req, reply),
        );
        return res.trips.map(toTrip).sort((a, b) => b.deliveredAt - a.deliveredAt);
      },
    );

    app.get(
      "/v1/trips/:id",
      {
        config,
        schema: {
          operationId: "getTrip",
          tags: ["rider"],
          security,
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          response: { 200: ref(Trip), ...problems(401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.getTrip.bind(u.dispatch),
          { riderId: riderOf(req), tripId: req.params.id },
          callContext(req, reply),
        );
        return toTrip(res.trip);
      },
    );

    app.post(
      "/v1/trips/:id/feedback",
      {
        config,
        schema: {
          operationId: "rateTrip",
          tags: ["rider"],
          security,
          summary: "The rider's thumbs on the customer and the restaurant",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          body: Type.Object({
            customer: Type.Optional(Type.Union([Type.Literal("up"), Type.Literal("down")])),
            restaurant: Type.Optional(Type.Union([Type.Literal("up"), Type.Literal("down")])),
          }),
          response: { 204: { type: "null" }, ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        await unary(
          u.reviews.submitTripFeedback.bind(u.reviews),
          {
            riderId: riderOf(req),
            deliveryId: req.params.id,
            orderId: "",
            customer: thumb(req.body.customer),
            restaurant: thumb(req.body.restaurant),
          },
          callContext(req, reply),
        );
        return reply.code(204).send(null);
      },
    );

    app.get(
      "/v1/ratings",
      {
        config,
        schema: {
          operationId: "getRatings",
          tags: ["rider"],
          security,
          response: { 200: ref(RatingsSummary), ...fail },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.reviews.getRiderRatingsSummary.bind(u.reviews),
          { riderId: riderOf(req) },
          callContext(req, reply),
        );
        return toRatings(res);
      },
    );

    // ---------- Money ----------

    app.get(
      "/v1/earnings",
      {
        config,
        schema: {
          operationId: "getEarnings",
          tags: ["earnings"],
          security,
          querystring: Type.Object({ period: Period }),
          response: { 200: ref(EarningsSummary), ...problems(400, 401, 403, 503, 504) },
        },
      },
      async (req, reply) => {
        const period = req.query.period as PeriodName;
        return toEarnings(await earnings(req, reply, period), period);
      },
    );

    app.get(
      "/v1/earnings/today",
      {
        config,
        schema: {
          operationId: "getTodaySummary",
          tags: ["earnings"],
          security,
          summary: "Today's figures for the home screen",
          response: { 200: ref(TodaySummary), ...fail },
        },
      },
      async (req, reply) => {
        const e = toEarnings(await earnings(req, reply, "today"), "today");
        return { amount: e.total, trips: e.trips, onlineMinutes: e.onlineMinutes, tips: e.tips };
      },
    );

    app.get(
      "/v1/quests",
      {
        config,
        schema: {
          operationId: "getQuests",
          tags: ["earnings"],
          security,
          response: { 200: Type.Array(ref(Quest)), ...fail },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.dispatch.listQuests.bind(u.dispatch),
          { riderId: riderOf(req) },
          callContext(req, reply),
        );
        return res.quests.map(toQuest);
      },
    );

    app.get(
      "/v1/cash",
      {
        config,
        schema: {
          operationId: "getCashBalance",
          tags: ["earnings"],
          security,
          response: { 200: ref(CashBalance), ...fail },
        },
      },
      async (req, reply) => {
        try {
          const res = await unary(
            u.finance.getRiderCashBalance.bind(u.finance),
            { riderId: riderOf(req) },
            callContext(req, reply),
          );
          return toCash(res.balance);
        } catch (err) {
          if (!ledgerDown(err)) throw err;
          req.log.debug({ err }, "ledger unavailable; cash from dispatch");
          const res = await unary(
            u.riders.getRiderProfile.bind(u.riders),
            { riderId: riderOf(req) },
            callContext(req, reply),
          );
          return cashFromRider(res.rider);
        }
      },
    );

    app.get(
      "/v1/payouts",
      {
        config,
        schema: {
          operationId: "listPayouts",
          tags: ["earnings"],
          security,
          response: { 200: Type.Array(ref(Payout)), ...fail },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.finance.listRiderPayouts.bind(u.finance),
          { riderId: riderOf(req), page: { pageSize: 26, pageToken: "" } },
          callContext(req, reply),
        );
        return res.payouts.map(toPayout);
      },
    );
  };
