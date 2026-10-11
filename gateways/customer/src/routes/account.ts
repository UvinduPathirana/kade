import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { PlusPlan } from "@kade/proto/kade/profile/v1/profile_service";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { CustomerEnsurer } from "../customers.js";
import { status } from "@grpc/grpc-js";
import { isServiceError, unary } from "../grpc/call.js";
import { toCard, toCredit, toGiftCard, toPlus, toReferral, toUser } from "../mappers/account.js";
import { geoFromMap } from "../mappers/geo.js";
import { isUuid, restaurantNumber } from "../mappers/ids.js";
import { appAddressId, brandFromName, fromSavedAddress, toSavedAddress } from "../mappers/orders.js";
import { fromRupees } from "../money.js";
import {
  AddCardInput,
  CardSetupSession,
  CreditAccount,
  GiftCard,
  GiftCardInput,
  JoinPlusInput,
  Me,
  Place,
  PlusMembership,
  ProfileInput,
  Referral,
  SavedAddress,
  SavedCard,
  User,
  problems,
  ref,
} from "../schemas.js";
import {
  bearer,
  httpError,
  idempotencyKey,
  requireIdentity,
  restaurantIdOr404,
  type RouteDeps,
} from "./context.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEGRADABLE = new Set<number>([status.UNAVAILABLE, status.DEADLINE_EXCEEDED, status.UNIMPLEMENTED]);

export const accountRoutes =
  ({ up, callContext, customers }: RouteDeps & { customers: CustomerEnsurer }): FastifyPluginAsyncTypebox =>
  async (app) => {
    const ctx = (req: FastifyRequest, reply: FastifyReply) => callContext(req, reply);
    const me = (req: FastifyRequest) => requireIdentity(req).userId;
    const tags = ["account"];

    app.get(
      "/v1/me",
      {
        schema: {
          operationId: "getMe",
          tags,
          summary: "The signed-in customer (created on first sign-in)",
          security: bearer,
          response: { 200: ref(Me), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const identity = requireIdentity(req);
        const res = await customers.ensure(identity, ctx(req, reply)).catch((err: unknown) => {
          // Profile down: sign-in still works from the token's claims; the profile is created on a
          // later request (every authenticated request ensures it).
          if (isServiceError(err) && DEGRADABLE.has(err.code)) {
            req.log.warn({ err }, "profile unavailable; answering /v1/me from the token");
            return {
              customer: undefined,
              isNew: false,
              fallback: {
                name: identity.name ?? "",
                phone: "",
                ...(identity.email ? { email: identity.email } : {}),
              },
            };
          }
          throw err;
        });
        const user = "fallback" in res ? res.fallback : toUser(res.customer);
        return { user, isNew: res.isNew || !user.name.trim(), plusActive: res.customer?.plusActive ?? false };
      },
    );

    app.put(
      "/v1/me",
      {
        schema: {
          operationId: "saveProfile",
          tags,
          summary: "Name and email",
          security: bearer,
          body: ref(ProfileInput),
          response: { 200: ref(User), ...problems(400, 401, 503, 504) },
        },
      },
      async (req, reply) => {
        const name = req.body.name.trim();
        const email = req.body.email?.trim() ?? "";
        if (!name) throw httpError(400, "NAME_REQUIRED", "Enter your name so riders know who to ask for.");
        if (email && !EMAIL.test(email))
          throw httpError(
            400,
            "EMAIL_INVALID",
            "That email address looks incomplete. Check it has an @ and a domain.",
          );
        const res = await unary(
          up.customer.updateProfile.bind(up.customer),
          { customerId: me(req), name, email },
          ctx(req, reply),
        );
        return toUser(res.customer);
      },
    );

    // ---------- Addresses ----------

    const listAddresses = async (req: FastifyRequest, reply: FastifyReply) =>
      (await unary(up.address.listAddresses.bind(up.address), { customerId: me(req) }, ctx(req, reply)))
        .addresses;

    /** The app's address id ("home", "work", a profile UUID, or a client id) -> profile id ("" = new). */
    async function profileAddressId(
      req: FastifyRequest,
      reply: FastifyReply,
      appId: string,
    ): Promise<string> {
      if (isUuid(appId)) return appId;
      if (appId === "home" || appId === "work") {
        const existing = (await listAddresses(req, reply)).find((a) => appAddressId(a) === appId);
        return existing?.id ?? "";
      }
      return "";
    }

    app.get(
      "/v1/me/addresses",
      {
        schema: {
          operationId: "listAddresses",
          tags,
          security: bearer,
          response: { 200: Type.Array(ref(SavedAddress)), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => (await listAddresses(req, reply)).map(toSavedAddress),
    );

    app.put(
      "/v1/me/addresses/:id",
      {
        schema: {
          operationId: "saveAddress",
          tags,
          summary: "Adds a new address, or replaces the one with the same id (home/work by label)",
          security: bearer,
          params: Type.Object({ id: Type.String({ maxLength: 64 }) }),
          body: ref(SavedAddress),
          response: { 200: ref(SavedAddress), ...problems(400, 401, 503, 504) },
        },
      },
      async (req, reply) => {
        const id = await profileAddressId(req, reply, req.params.id);
        const res = await unary(
          up.address.saveAddress.bind(up.address),
          { customerId: me(req), address: fromSavedAddress(req.body, id) },
          ctx(req, reply),
        );
        return res.address ? toSavedAddress(res.address) : req.body;
      },
    );

    app.delete(
      "/v1/me/addresses/:id",
      {
        schema: {
          operationId: "removeAddress",
          tags,
          security: bearer,
          params: Type.Object({ id: Type.String({ maxLength: 64 }) }),
          response: { 204: Type.Null(), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const id = await profileAddressId(req, reply, req.params.id);
        if (id) {
          await unary(
            up.address.removeAddress.bind(up.address),
            { customerId: me(req), addressId: id },
            ctx(req, reply),
          );
        }
        return reply.code(204).send(null);
      },
    );

    app.post(
      "/v1/waitlist",
      {
        config: { auth: "optional" },
        schema: {
          operationId: "joinWaitlist",
          tags,
          summary: '"Tell me when you deliver here." Signed-out requests are accepted and not stored.',
          body: ref(Place),
          response: { 204: Type.Null(), ...problems(400, 503, 504) },
        },
      },
      async (req, reply) => {
        if (req.identity) {
          await unary(
            up.address.joinWaitlist.bind(up.address),
            {
              customerId: req.identity.userId,
              placeId: req.body.id,
              placeName: req.body.name,
              area: req.body.area,
              location: req.body.pin ? geoFromMap(req.body.pin) : undefined,
            },
            ctx(req, reply),
          );
        }
        return reply.code(204).send(null);
      },
    );

    // ---------- Favourites ----------

    app.get(
      "/v1/me/favourites",
      {
        schema: {
          operationId: "listFavourites",
          tags,
          security: bearer,
          response: { 200: Type.Array(Type.Integer()), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.favourite.listFavourites.bind(up.favourite),
          { customerId: me(req) },
          ctx(req, reply),
        );
        return res.favourites.map((f) => restaurantNumber(f.restaurantId));
      },
    );

    const FavParams = Type.Object({ restaurantId: Type.Integer({ minimum: 1 }) });
    app.put(
      "/v1/me/favourites/:restaurantId",
      {
        schema: {
          operationId: "addFavourite",
          tags,
          security: bearer,
          params: FavParams,
          response: { 204: Type.Null(), ...problems(401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        await unary(
          up.favourite.addFavourite.bind(up.favourite),
          { customerId: me(req), restaurantId: restaurantIdOr404(req.params.restaurantId) },
          ctx(req, reply),
        );
        return reply.code(204).send(null);
      },
    );
    app.delete(
      "/v1/me/favourites/:restaurantId",
      {
        schema: {
          operationId: "removeFavourite",
          tags,
          security: bearer,
          params: FavParams,
          response: { 204: Type.Null(), ...problems(401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        await unary(
          up.favourite.removeFavourite.bind(up.favourite),
          { customerId: me(req), restaurantId: restaurantIdOr404(req.params.restaurantId) },
          ctx(req, reply),
        );
        return reply.code(204).send(null);
      },
    );

    // ---------- Saved cards (payment) ----------

    app.get(
      "/v1/me/cards",
      {
        schema: {
          operationId: "listCards",
          tags,
          security: bearer,
          response: { 200: Type.Array(ref(SavedCard)), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.savedCard.listSavedCards.bind(up.savedCard),
          { customerId: me(req) },
          ctx(req, reply),
        );
        return res.cards.map(toCard);
      },
    );

    app.post(
      "/v1/me/cards/session",
      {
        schema: {
          operationId: "createCardSetupSession",
          tags,
          summary: "Starts a PSP card-capture session; the app sends the card to the PSP, never to Kadé",
          security: bearer,
          response: { 200: ref(CardSetupSession), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.savedCard.createCardSetupSession.bind(up.savedCard),
          { customerId: me(req) },
          ctx(req, reply),
        );
        return { sessionId: res.sessionId, clientSecret: res.clientSecret, pspUrl: res.pspUrl };
      },
    );

    app.post(
      "/v1/me/cards",
      {
        schema: {
          operationId: "addCard",
          tags,
          summary: "Saves the PSP token from a setup session",
          security: bearer,
          body: ref(AddCardInput),
          response: { 201: ref(SavedCard), ...problems(400, 401, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const [mm = "0", yy = "0"] = req.body.expiry.split("/");
        const res = await unary(
          up.savedCard.addSavedCard.bind(up.savedCard),
          {
            customerId: me(req),
            sessionId: req.body.sessionId,
            pspToken: req.body.pspToken,
            brand: brandFromName(req.body.brand),
            last4: req.body.last4,
            expiryMonth: parseInt(mm, 10),
            expiryYear: 2000 + parseInt(yy, 10),
            holderName: req.body.holderName,
            fingerprint: req.body.fingerprint ?? "",
          },
          ctx(req, reply),
        );
        if (!res.card) throw new Error("payment returned no card");
        return reply.code(201).send(toCard(res.card));
      },
    );

    app.delete(
      "/v1/me/cards/:id",
      {
        schema: {
          operationId: "removeCard",
          tags,
          security: bearer,
          params: Type.Object({ id: Type.String({ maxLength: 64 }) }),
          response: { 204: Type.Null(), ...problems(401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        await unary(
          up.savedCard.removeSavedCard.bind(up.savedCard),
          { customerId: me(req), cardId: req.params.id },
          ctx(req, reply),
        );
        return reply.code(204).send(null);
      },
    );

    // ---------- Kadé credit and Plus (profile) ----------

    app.get(
      "/v1/me/credit",
      {
        schema: {
          operationId: "getCredit",
          tags,
          security: bearer,
          response: { 200: ref(CreditAccount), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.credit.getCreditAccount.bind(up.credit),
          { customerId: me(req), page: { pageSize: 50, pageToken: "" } },
          ctx(req, reply),
        );
        return toCredit(res.account);
      },
    );

    app.get(
      "/v1/me/plus",
      {
        schema: {
          operationId: "getPlus",
          tags,
          security: bearer,
          response: { 200: ref(PlusMembership), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.plus.getPlusMembership.bind(up.plus),
          { customerId: me(req) },
          ctx(req, reply),
        );
        return toPlus(res.membership);
      },
    );

    app.post(
      "/v1/me/plus",
      {
        schema: {
          operationId: "joinPlus",
          tags,
          summary: "Starts the free month",
          security: bearer,
          body: ref(JoinPlusInput),
          response: { 200: ref(PlusMembership), ...problems(400, 401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.plus.joinPlus.bind(up.plus),
          {
            customerId: me(req),
            plan: req.body.plan === "yearly" ? PlusPlan.PLUS_PLAN_YEARLY : PlusPlan.PLUS_PLAN_MONTHLY,
            cardId: req.body.cardId,
            idempotencyKey: idempotencyKey(req, randomUUID()),
          },
          ctx(req, reply),
        );
        return toPlus(res.membership);
      },
    );

    app.delete(
      "/v1/me/plus",
      {
        schema: {
          operationId: "cancelPlus",
          tags,
          summary: "Benefits last until the end of the period already paid for",
          security: bearer,
          response: { 200: ref(PlusMembership), ...problems(400, 401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(up.plus.cancelPlus.bind(up.plus), { customerId: me(req) }, ctx(req, reply));
        return toPlus(res.membership);
      },
    );

    // ---------- Gift cards and referrals (promotion) ----------

    app.get(
      "/v1/me/gift-cards",
      {
        schema: {
          operationId: "listGiftCards",
          tags,
          security: bearer,
          response: { 200: Type.Array(ref(GiftCard)), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.giftCard.listGiftCards.bind(up.giftCard),
          { customerId: me(req) },
          ctx(req, reply),
        );
        return res.giftCards.map(toGiftCard);
      },
    );

    app.post(
      "/v1/me/gift-cards",
      {
        schema: {
          operationId: "buyGiftCard",
          tags,
          security: bearer,
          body: ref(GiftCardInput),
          response: { 201: ref(GiftCard), ...problems(400, 401, 402, 503, 504) },
        },
      },
      async (req, reply) => {
        const b = req.body;
        if (!b.to.trim())
          throw httpError(400, "GIFT_TO_REQUIRED", "Add the name of the person you're sending it to.");
        if (!b.contact.trim())
          throw httpError(
            400,
            "GIFT_CONTACT_REQUIRED",
            "Add their mobile number or email so we can send it.",
          );
        const res = await unary(
          up.giftCard.buyGiftCard.bind(up.giftCard),
          {
            customerId: me(req),
            amount: fromRupees(b.amount),
            to: b.to.trim(),
            contact: b.contact.trim(),
            message: b.message.trim(),
            sendOn: b.sendOn,
            cardId: b.cardId,
            idempotencyKey: idempotencyKey(req, randomUUID()),
          },
          ctx(req, reply),
        );
        if (!res.giftCard) throw new Error("promotion returned no gift card");
        return reply.code(201).send(toGiftCard(res.giftCard));
      },
    );

    app.get(
      "/v1/me/referral",
      {
        schema: {
          operationId: "getReferral",
          tags,
          security: bearer,
          querystring: Type.Object({ firstName: Type.Optional(Type.String({ maxLength: 60 })) }),
          response: { 200: ref(Referral), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.referral.getReferral.bind(up.referral),
          { customerId: me(req), firstName: req.query.firstName ?? "" },
          ctx(req, reply),
        );
        return toReferral(res);
      },
    );
  };
