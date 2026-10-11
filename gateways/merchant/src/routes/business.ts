import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import { fromOfferInput, toDailySales, toOffer, toReview, toStatement } from "../mappers.js";
import { ProblemError } from "../problem.js";
import { DailySales, Offer, OfferInput, Review, Statement, problems, ref } from "../schemas.js";
import {
  IdempotencyHeaders,
  OWNER,
  STAFF,
  idempotencyKey,
  outletOf,
  security,
  type RouteDeps,
} from "./context.js";

const IsoDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

/** Promotions (promotion OfferService), sales and statements (ledger), reviews (review). */
export const businessRoutes =
  ({ u, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const staff = { roles: STAFF };
    const owner = { roles: OWNER };

    // ---------- Promotions ----------

    app.get(
      "/v1/offers",
      {
        config: staff,
        schema: {
          operationId: "listOffers",
          tags: ["promotions"],
          security,
          summary: "The outlet's offers: active, scheduled and ended",
          response: { 200: Type.Array(ref(Offer)), ...problems(401, 403, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.offers.listOffers.bind(u.offers),
          { restaurantId: outletOf(req) },
          callContext(req, reply),
        );
        return res.offers.map(toOffer);
      },
    );

    app.post(
      "/v1/offers",
      {
        config: staff,
        schema: {
          operationId: "createOffer",
          tags: ["promotions"],
          security,
          summary: "Creates a restaurant-funded offer with a budget",
          headers: IdempotencyHeaders,
          body: ref(OfferInput),
          response: { 201: ref(Offer), ...problems(400, 401, 403, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        if (req.body.endDate < req.body.startDate) {
          throw new ProblemError(400, "OFFER_DATES_INVALID", "The end date is before the start date.");
        }
        const restaurantId = outletOf(req);
        const res = await unary(
          u.offers.createOffer.bind(u.offers),
          {
            restaurantId,
            offer: fromOfferInput(restaurantId, req.body),
            idempotencyKey: idempotencyKey(req),
          },
          callContext(req, reply),
        );
        return reply.code(201).send(toOffer(res.offer));
      },
    );

    app.post(
      "/v1/offers/:id/end",
      {
        config: staff,
        schema: {
          operationId: "endOffer",
          tags: ["promotions"],
          security,
          summary: "Ends an active offer now, or cancels a scheduled one",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          response: { 200: ref(Offer), ...problems(401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.offers.endOffer.bind(u.offers),
          { restaurantId: outletOf(req), offerId: req.params.id },
          callContext(req, reply),
        );
        return toOffer(res.offer);
      },
    );

    // ---------- Sales and statements (owners only: payouts and bank details) ----------

    app.get(
      "/v1/sales",
      {
        config: owner,
        schema: {
          operationId: "getSales",
          tags: ["payouts"],
          security,
          summary: "Daily sales between two dates (inclusive)",
          querystring: Type.Object({ from: IsoDate, to: IsoDate }),
          response: { 200: Type.Array(ref(DailySales)), ...problems(400, 401, 403, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.finance.getOutletSales.bind(u.finance),
          { outletId: outletOf(req), period: { fromDate: req.query.from, toDate: req.query.to } },
          callContext(req, reply),
        );
        return res.days.map(toDailySales).sort((a, b) => a.date.localeCompare(b.date));
      },
    );

    app.get(
      "/v1/statements",
      {
        config: owner,
        schema: {
          operationId: "listStatements",
          tags: ["payouts"],
          security,
          summary: "Weekly statements, newest first (the current week first)",
          response: { 200: Type.Array(ref(Statement)), ...problems(401, 403, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.finance.listOutletStatements.bind(u.finance),
          { outletId: outletOf(req), page: { pageSize: 9, pageToken: "" } },
          callContext(req, reply),
        );
        return res.statements.map(toStatement).sort((a, b) => b.from.localeCompare(a.from));
      },
    );

    app.get(
      "/v1/statements/:id/csv",
      {
        config: owner,
        schema: {
          operationId: "statementCsv",
          tags: ["payouts"],
          security,
          summary: "The statement as CSV (text/csv)",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          response: {
            200: { description: "CSV file", content: { "text/csv": { schema: Type.String() } } },
            ...problems(401, 403, 404, 503, 504),
          },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.finance.exportOutletStatementCsv.bind(u.finance),
          { outletId: outletOf(req), statementId: req.params.id },
          callContext(req, reply),
        );
        const name = (res.fileName || `kade-statement-${req.params.id}.csv`).replace(/[^\w.-]/g, "_");
        return reply
          .type("text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="${name}"`)
          .send(Buffer.from(res.csv).toString("utf8"));
      },
    );

    // ---------- Reviews ----------

    app.get(
      "/v1/reviews",
      {
        config: staff,
        schema: {
          operationId: "listReviews",
          tags: ["reviews"],
          security,
          summary: "The outlet's reviews, newest first",
          response: { 200: Type.Array(ref(Review)), ...problems(401, 403, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.reviews.listRestaurantReviews.bind(u.reviews),
          {
            restaurantId: outletOf(req),
            withTextOnly: false,
            unrepliedOnly: false,
            maxStars: 0,
            page: { pageSize: 100, pageToken: "" },
          },
          callContext(req, reply),
        );
        return res.reviews.map(toReview);
      },
    );

    app.put(
      "/v1/reviews/:id/reply",
      {
        config: staff,
        schema: {
          operationId: "replyToReview",
          tags: ["reviews"],
          security,
          summary: "Posts or replaces the outlet's public reply; empty text removes it",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          body: Type.Object({ text: Type.String({ maxLength: 1000 }) }),
          response: { 200: ref(Review), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.reviews.replyToReview.bind(u.reviews),
          {
            reviewId: req.params.id,
            outletId: outletOf(req),
            text: req.body.text.trim(),
            by: req.identity?.name ?? "",
          },
          callContext(req, reply),
        );
        return toReview(res.review);
      },
    );
  };
