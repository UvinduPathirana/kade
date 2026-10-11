import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { MoveDirection } from "@kade/proto/kade/catalog/v1/catalog_service";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import { fromMenuItemInput, toMenu } from "../mappers.js";
import { Menu, MenuItemInput, problems, ref } from "../schemas.js";
import { IdempotencyHeaders, STAFF, idempotencyKey, outletOf, security, type RouteDeps } from "./context.js";

/** Menu editing in catalog (restaurant_id = the caller's outlet). Every change answers with the menu. */
export const menuRoutes =
  ({ u, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const config = { roles: STAFF };
    const tags = ["menu"];
    const answers = { 200: ref(Menu), ...problems(400, 401, 403, 404, 409, 503, 504) };
    const itemParams = Type.Object({ id: Type.String({ minLength: 1 }) });

    app.get(
      "/v1/menu",
      {
        config,
        schema: {
          operationId: "getMenu",
          tags,
          security,
          summary: "The outlet's full menu",
          response: answers,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.catalog.getMenu.bind(u.catalog),
          { restaurantId: outletOf(req) },
          callContext(req, reply),
        );
        return toMenu(res.menu);
      },
    );

    app.put(
      "/v1/menu/items/:id/sold-out",
      {
        config,
        schema: {
          operationId: "setSoldOut",
          tags,
          security,
          summary: "Sold out today (resets at the next opening)",
          params: itemParams,
          body: Type.Object({ soldOut: Type.Boolean() }),
          response: answers,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.menus.setMenuItemSoldOut.bind(u.menus),
          { restaurantId: outletOf(req), itemId: req.params.id, soldOut: req.body.soldOut },
          callContext(req, reply),
        );
        return toMenu(res.menu);
      },
    );

    app.post(
      "/v1/menu/items",
      {
        config,
        // Uploaded photos arrive as data: URLs until there is an upload service.
        bodyLimit: 3 * 1024 * 1024,
        schema: {
          operationId: "saveItem",
          tags,
          security,
          summary: "Creates the dish when it has no id; otherwise updates it (and moves it between sections)",
          headers: IdempotencyHeaders,
          body: ref(MenuItemInput),
          response: answers,
        },
      },
      async (req, reply) => {
        const restaurantId = outletOf(req);
        const res = await unary(
          u.menus.saveMenuItem.bind(u.menus),
          {
            restaurantId,
            item: fromMenuItemInput(restaurantId, req.body),
            idempotencyKey: idempotencyKey(req),
          },
          callContext(req, reply),
        );
        return toMenu(res.menu);
      },
    );

    app.delete(
      "/v1/menu/items/:id",
      {
        config,
        schema: {
          operationId: "deleteItem",
          tags,
          security,
          summary: "Removes a dish",
          params: itemParams,
          response: answers,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.menus.deleteMenuItem.bind(u.menus),
          { restaurantId: outletOf(req), itemId: req.params.id },
          callContext(req, reply),
        );
        return toMenu(res.menu);
      },
    );

    app.post(
      "/v1/menu/sections",
      {
        config,
        schema: {
          operationId: "addSection",
          tags,
          security,
          summary: "Adds a section (unique name)",
          body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }) }),
          response: answers,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.menus.createMenuSection.bind(u.menus),
          { restaurantId: outletOf(req), name: req.body.name.trim() },
          callContext(req, reply),
        );
        return toMenu(res.menu);
      },
    );

    app.post(
      "/v1/menu/sections/:id/move",
      {
        config,
        schema: {
          operationId: "moveSection",
          tags,
          security,
          summary: "Moves a section up (-1) or down (1)",
          params: itemParams,
          body: Type.Object({ direction: Type.Union([Type.Literal(-1), Type.Literal(1)]) }),
          response: answers,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.menus.moveMenuSection.bind(u.menus),
          {
            restaurantId: outletOf(req),
            sectionId: req.params.id,
            direction:
              req.body.direction < 0 ? MoveDirection.MOVE_DIRECTION_UP : MoveDirection.MOVE_DIRECTION_DOWN,
          },
          callContext(req, reply),
        );
        return toMenu(res.menu);
      },
    );
  };
