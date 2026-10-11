import { Inject, Injectable } from "@nestjs/common";
import {
  DishTag,
  MenuManagementServiceService,
  MoveDirection,
  SaveMenuItemRequest,
  SaveMenuItemResponse,
  type CreateMenuSectionRequest,
  type CreateMenuSectionResponse,
  type DeleteMenuItemRequest,
  type DeleteMenuItemResponse,
  type DeleteMenuSectionRequest,
  type DeleteMenuSectionResponse,
  type DeleteOptionGroupRequest,
  type DeleteOptionGroupResponse,
  type Menu,
  type MoveMenuSectionRequest,
  type MoveMenuSectionResponse,
  type RenameMenuSectionRequest,
  type RenameMenuSectionResponse,
  type SaveOptionGroupRequest,
  type SaveOptionGroupResponse,
  type SetMenuItemSoldOutRequest,
  type SetMenuItemSoldOutResponse,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { menuItems, menuSections, optionGroups, type ChoiceJson } from "../db/schema.js";
import { Database, type Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { alreadyExists, failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { CLOCK, requireOutletAccess, type Clock } from "./access.js";
import { CatalogEvents } from "./events.js";
import { nextOpening } from "./hours.js";
import { isUuid } from "./ids.js";
import { closedDates, toMenu, type MenuRows, type RestaurantRow } from "./model.js";
import { CatalogStore } from "./store.js";

const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;
const MAX_SECTION_NAME = 60;
const MAX_CHOICES = 20;

/**
 * kade.catalog.v1.MenuManagementService: the restaurant app's menu editor. Every change locks the
 * restaurant row, bumps the menu version and publishes the whole menu (MenuUpdated) in the same
 * transaction; sold-out toggles publish the smaller MenuItemAvailabilityChanged.
 */
@GrpcService(MenuManagementServiceService)
@Injectable()
export class MenuManagementGrpcService implements GrpcHandlers<MenuManagementServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CatalogStore) private readonly store: CatalogStore,
    @Inject(CatalogEvents) private readonly events: CatalogEvents,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async saveMenuItem(request: SaveMenuItemRequest, ctx: RequestContext): Promise<SaveMenuItemResponse> {
    const input = request.item;
    if (!input) throw invalidArgument("ITEM_REQUIRED", "Send the dish to save.", { field: "item" });
    const name = input.name.trim();
    if (!name) throw invalidArgument("ITEM_NAME_REQUIRED", "Give the dish a name.", { field: "item.name" });
    if (name.length > MAX_NAME) {
      throw invalidArgument("ITEM_NAME_TOO_LONG", `Keep the name under ${MAX_NAME} characters.`, {
        field: "item.name",
      });
    }
    const description = input.description.trim();
    if (description.length > MAX_DESCRIPTION) {
      throw invalidArgument(
        "ITEM_DESCRIPTION_TOO_LONG",
        `Keep the description under ${MAX_DESCRIPTION} characters.`,
        {
          field: "item.description",
        },
      );
    }
    const priceMinor = input.price?.amountMinor ?? 0;
    if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) {
      throw invalidArgument("ITEM_PRICE_INVALID", "Set a price above Rs 0.", { field: "item.price" });
    }
    if (input.price?.currency && input.price.currency !== "LKR") {
      throw invalidArgument("CURRENCY_UNSUPPORTED", "Only LKR is supported.", {
        field: "item.price.currency",
      });
    }
    if (input.id && !isUuid(input.id)) {
      throw invalidArgument("ITEM_ID_INVALID", "Dish id must be a UUID.", { field: "item.id" });
    }
    const tags = [...new Set(input.tags)].filter(
      (t) => t === DishTag.DISH_TAG_VEGETARIAN || t === DishTag.DISH_TAG_SPICY,
    );

    let saved: string | undefined;
    const run = async (tx: Tx, restaurant: RestaurantRow): Promise<void> => {
      const sectionId = input.sectionId.toLowerCase();
      const [section] = isUuid(sectionId)
        ? await tx
            .select()
            .from(menuSections)
            .where(and(eq(menuSections.id, sectionId), eq(menuSections.restaurantId, restaurant.id)))
        : [];
      if (!section) {
        throw invalidArgument("SECTION_REQUIRED", "Choose a section for this dish.", {
          field: "item.section_id",
        });
      }
      const groupIds = [...new Set(input.optionGroupIds.map((g) => g.toLowerCase()))];
      if (groupIds.length) {
        const known = await tx
          .select({ id: optionGroups.id })
          .from(optionGroups)
          .where(eq(optionGroups.restaurantId, restaurant.id));
        const ok = new Set(known.map((k) => k.id));
        if (groupIds.some((g) => !ok.has(g))) {
          throw invalidArgument("OPTION_GROUP_NOT_FOUND", "One of those option groups no longer exists.", {
            field: "item.option_group_ids",
          });
        }
      }
      const fields = {
        name,
        description,
        priceMinor,
        imageId: input.imageId.trim(),
        tags,
        optionGroupIds: groupIds,
        unit: input.unit.trim(),
      };
      const endOfSection = async (): Promise<number> => {
        const [row] = await tx
          .select({ max: sql<number>`coalesce(max(${menuItems.position}), -1)` })
          .from(menuItems)
          .where(eq(menuItems.sectionId, section.id));
        return Number(row?.max ?? -1) + 1;
      };

      if (!input.id) {
        saved = uuidv7();
        await tx.insert(menuItems).values({
          id: saved,
          restaurantId: restaurant.id,
          sectionId: section.id,
          position: await endOfSection(),
          ...fields,
        });
        return;
      }
      const [existing] = await tx
        .select()
        .from(menuItems)
        .where(and(eq(menuItems.id, input.id.toLowerCase()), eq(menuItems.restaurantId, restaurant.id)));
      if (!existing)
        throw notFound("ITEM_NOT_FOUND", "This dish is no longer on the menu.", { item_id: input.id });
      saved = existing.id;
      const moved = existing.sectionId !== section.id;
      await tx
        .update(menuItems)
        .set({ ...fields, sectionId: section.id, position: moved ? await endOfSection() : existing.position })
        .where(eq(menuItems.id, existing.id));
    };

    return this.database.transaction(ctx, async (tx) => {
      const restaurant = await this.lockForEdit(tx, request.restaurantId, ctx);
      return this.idempotency.run(
        tx,
        {
          scope: `SaveMenuItem:${restaurant.id}`,
          key: request.idempotencyKey,
          request: SaveMenuItemRequest.encode(request).finish(),
          codec: SaveMenuItemResponse,
        },
        async () => {
          await run(tx, restaurant);
          const menu = await this.publish(tx, restaurant);
          const item = menu.sections.flatMap((s) => s.items).find((i) => i.id === saved);
          return { menu, item };
        },
      );
    });
  }

  async deleteMenuItem(request: DeleteMenuItemRequest, ctx: RequestContext): Promise<DeleteMenuItemResponse> {
    return this.edit(ctx, request.restaurantId, async (tx, restaurant) => {
      const deleted = isUuid(request.itemId)
        ? await tx
            .delete(menuItems)
            .where(
              and(eq(menuItems.id, request.itemId.toLowerCase()), eq(menuItems.restaurantId, restaurant.id)),
            )
            .returning({ id: menuItems.id })
        : [];
      if (deleted.length === 0) {
        throw notFound("ITEM_NOT_FOUND", "This dish is no longer on the menu.", { item_id: request.itemId });
      }
    });
  }

  async setMenuItemSoldOut(
    request: SetMenuItemSoldOutRequest,
    ctx: RequestContext,
  ): Promise<SetMenuItemSoldOutResponse> {
    return this.database.transaction(ctx, async (tx) => {
      const restaurant = await this.lockForEdit(tx, request.restaurantId, ctx);
      const [item] = isUuid(request.itemId)
        ? await tx
            .select()
            .from(menuItems)
            .where(
              and(eq(menuItems.id, request.itemId.toLowerCase()), eq(menuItems.restaurantId, restaurant.id)),
            )
        : [];
      if (!item)
        throw notFound("ITEM_NOT_FOUND", "This dish is no longer on the menu.", { item_id: request.itemId });
      const now = this.clock();
      // "Sold out today": it comes back by itself at the next opening.
      const closures = await this.store.closuresOf(tx, restaurant.id);
      const until = request.soldOut
        ? (nextOpening(restaurant.hours, closedDates(closures), now) ?? null)
        : null;
      await tx
        .update(menuItems)
        .set({ soldOut: request.soldOut, soldOutUntil: until })
        .where(eq(menuItems.id, item.id));
      const bumped = await this.store.bumpMenuVersion(tx, restaurant.id);
      const menu = toMenu(await this.store.menuRows(tx, bumped), now);
      await this.events.itemAvailabilityChanged(tx, {
        restaurantId: restaurant.id,
        itemId: item.id,
        itemName: item.name,
        soldOut: request.soldOut,
        soldOutUntil: until ?? undefined,
        menuVersion: bumped.menuVersion,
      });
      return { menu };
    });
  }

  async createMenuSection(
    request: CreateMenuSectionRequest,
    ctx: RequestContext,
  ): Promise<CreateMenuSectionResponse> {
    const name = sectionName(request.name);
    return this.edit(ctx, request.restaurantId, async (tx, restaurant) => {
      const sections = await tx
        .select()
        .from(menuSections)
        .where(eq(menuSections.restaurantId, restaurant.id));
      assertUniqueSection(sections, name);
      const position = sections.reduce((m, s) => Math.max(m, s.position), -1) + 1;
      await tx.insert(menuSections).values({ id: uuidv7(), restaurantId: restaurant.id, name, position });
    });
  }

  async renameMenuSection(
    request: RenameMenuSectionRequest,
    ctx: RequestContext,
  ): Promise<RenameMenuSectionResponse> {
    const name = sectionName(request.name);
    return this.edit(ctx, request.restaurantId, async (tx, restaurant) => {
      const sections = await tx
        .select()
        .from(menuSections)
        .where(eq(menuSections.restaurantId, restaurant.id));
      const section = findSection(sections, request.sectionId);
      assertUniqueSection(
        sections.filter((s) => s.id !== section.id),
        name,
      );
      await tx.update(menuSections).set({ name }).where(eq(menuSections.id, section.id));
    });
  }

  async deleteMenuSection(
    request: DeleteMenuSectionRequest,
    ctx: RequestContext,
  ): Promise<DeleteMenuSectionResponse> {
    return this.edit(ctx, request.restaurantId, async (tx, restaurant) => {
      const sections = await tx
        .select()
        .from(menuSections)
        .where(eq(menuSections.restaurantId, restaurant.id));
      const section = findSection(sections, request.sectionId);
      const items = await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(eq(menuItems.sectionId, section.id));
      if (items.length > 0) {
        throw failedPrecondition("SECTION_NOT_EMPTY", "Move or delete the dishes in this section first.", {
          section_id: section.id,
        });
      }
      await tx.delete(menuSections).where(eq(menuSections.id, section.id));
    });
  }

  async moveMenuSection(
    request: MoveMenuSectionRequest,
    ctx: RequestContext,
  ): Promise<MoveMenuSectionResponse> {
    const step = directionStep(request.direction);
    return this.edit(ctx, request.restaurantId, async (tx, restaurant) => {
      const sections = (
        await tx.select().from(menuSections).where(eq(menuSections.restaurantId, restaurant.id))
      ).sort((a, b) => a.position - b.position);
      const section = findSection(sections, request.sectionId);
      const i = sections.indexOf(section);
      const other = sections[i + step];
      if (!other) return; // already at the edge: nothing to do (the app disables the button)
      await tx.update(menuSections).set({ position: other.position }).where(eq(menuSections.id, section.id));
      await tx.update(menuSections).set({ position: section.position }).where(eq(menuSections.id, other.id));
    });
  }

  async saveOptionGroup(
    request: SaveOptionGroupRequest,
    ctx: RequestContext,
  ): Promise<SaveOptionGroupResponse> {
    const input = request.optionGroup;
    if (!input)
      throw invalidArgument("OPTION_GROUP_REQUIRED", "Send the option group to save.", {
        field: "option_group",
      });
    const name = input.name.trim();
    if (!name)
      throw invalidArgument("OPTION_GROUP_NAME_REQUIRED", "Give the option group a name.", {
        field: "option_group.name",
      });
    if (input.choices.length === 0 || input.choices.length > MAX_CHOICES) {
      throw invalidArgument("OPTION_CHOICES_INVALID", `Add between 1 and ${MAX_CHOICES} choices.`, {
        field: "option_group.choices",
      });
    }
    const maxChoices = input.maxChoices > 0 ? input.maxChoices : 1;
    if (maxChoices > input.choices.length) {
      throw invalidArgument("OPTION_MAX_INVALID", "Customers can't pick more choices than there are.", {
        field: "option_group.max_choices",
      });
    }
    for (const c of input.choices) {
      const price = c.price?.amountMinor ?? 0;
      if (!c.name.trim()) {
        throw invalidArgument("OPTION_CHOICE_NAME_REQUIRED", "Every choice needs a name.", {
          field: "option_group.choices",
        });
      }
      if (!Number.isSafeInteger(price) || price < 0) {
        throw invalidArgument("OPTION_CHOICE_PRICE_INVALID", "Choice prices can't be negative.", {
          field: "option_group.choices",
        });
      }
    }
    if (input.id && !isUuid(input.id)) {
      throw invalidArgument("OPTION_GROUP_ID_INVALID", "Option group id must be a UUID.", {
        field: "option_group.id",
      });
    }

    return this.edit(ctx, request.restaurantId, async (tx, restaurant) => {
      const groups = await tx.select().from(optionGroups).where(eq(optionGroups.restaurantId, restaurant.id));
      const existing = input.id ? groups.find((g) => g.id === input.id.toLowerCase()) : undefined;
      if (input.id && !existing) {
        throw notFound("OPTION_GROUP_NOT_FOUND", "That option group no longer exists.", {
          option_group_id: input.id,
        });
      }
      const keep = new Set(existing?.choices.map((c) => c.id));
      const choices: ChoiceJson[] = input.choices.map((c) => ({
        id: c.id && keep.has(c.id.toLowerCase()) ? c.id.toLowerCase() : uuidv7(),
        name: c.name.trim(),
        priceMinor: c.price?.amountMinor ?? 0,
      }));
      const values = { name, required: input.required, maxChoices, choices };
      if (existing) {
        await tx.update(optionGroups).set(values).where(eq(optionGroups.id, existing.id));
      } else {
        const position = groups.reduce((m, g) => Math.max(m, g.position), -1) + 1;
        await tx
          .insert(optionGroups)
          .values({ id: uuidv7(), restaurantId: restaurant.id, position, ...values });
      }
    });
  }

  async deleteOptionGroup(
    request: DeleteOptionGroupRequest,
    ctx: RequestContext,
  ): Promise<DeleteOptionGroupResponse> {
    return this.edit(ctx, request.restaurantId, async (tx, restaurant) => {
      const id = request.optionGroupId.toLowerCase();
      const deleted = isUuid(id)
        ? await tx
            .delete(optionGroups)
            .where(and(eq(optionGroups.id, id), eq(optionGroups.restaurantId, restaurant.id)))
            .returning({ id: optionGroups.id })
        : [];
      if (deleted.length === 0) {
        throw notFound("OPTION_GROUP_NOT_FOUND", "That option group no longer exists.", {
          option_group_id: request.optionGroupId,
        });
      }
      await tx
        .update(menuItems)
        .set({ optionGroupIds: sql`array_remove(${menuItems.optionGroupIds}, ${id})` })
        .where(eq(menuItems.restaurantId, restaurant.id));
    });
  }

  // ---------- helpers ----------

  private async lockForEdit(tx: Tx, ref: string, ctx: RequestContext): Promise<RestaurantRow> {
    const restaurant = await this.store.requireRestaurant(tx, ref || ctx.outletId || "", { lock: true });
    requireOutletAccess(ctx, restaurant.id);
    return restaurant;
  }

  /** Lock, change, bump the version, publish MenuUpdated; returns the new menu. */
  private async edit(
    ctx: RequestContext,
    ref: string,
    change: (tx: Tx, restaurant: RestaurantRow) => Promise<void>,
  ): Promise<{ menu: Menu }> {
    return this.database.transaction(ctx, async (tx) => {
      const restaurant = await this.lockForEdit(tx, ref, ctx);
      await change(tx, restaurant);
      return { menu: await this.publish(tx, restaurant) };
    });
  }

  private async publish(tx: Tx, restaurant: RestaurantRow): Promise<Menu> {
    const now = this.clock();
    const bumped = await this.store.bumpMenuVersion(tx, restaurant.id);
    const rows: MenuRows = await this.store.menuRows(tx, bumped);
    const menu = toMenu(rows, now);
    await this.events.menuUpdated(tx, menu);
    // The "vegetarian options" filter follows the menu.
    const hasVegetarian = rows.items.some((i) => i.tags.includes(DishTag.DISH_TAG_VEGETARIAN));
    if (hasVegetarian !== bumped.hasVegetarian) {
      const updated = await this.store.updateRestaurant(tx, bumped.id, { hasVegetarian });
      const closures = await this.store.closuresOf(tx, bumped.id);
      await this.events.restaurantUpdated(tx, updated, closures, ["has_vegetarian"], now);
    }
    return menu;
  }
}

function sectionName(raw: string): string {
  const name = raw.trim();
  if (!name) throw invalidArgument("SECTION_NAME_REQUIRED", "Give the section a name.", { field: "name" });
  if (name.length > MAX_SECTION_NAME) {
    throw invalidArgument("SECTION_NAME_TOO_LONG", `Keep the name under ${MAX_SECTION_NAME} characters.`, {
      field: "name",
    });
  }
  return name;
}

function assertUniqueSection(sections: { name: string }[], name: string): void {
  if (sections.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    throw alreadyExists("SECTION_NAME_TAKEN", `There's already a section called ${name}.`, { name });
  }
}

function findSection<T extends { id: string }>(sections: T[], id: string): T {
  const section = sections.find((s) => s.id === id.toLowerCase());
  if (!section) throw notFound("SECTION_NOT_FOUND", "That section no longer exists.", { section_id: id });
  return section;
}

export function directionStep(direction: MoveDirection): -1 | 1 {
  if (direction === MoveDirection.MOVE_DIRECTION_UP) return -1;
  if (direction === MoveDirection.MOVE_DIRECTION_DOWN) return 1;
  throw invalidArgument("DIRECTION_REQUIRED", "Say which way to move it.", { field: "direction" });
}
