import { Inject, Injectable } from "@nestjs/common";
import { LineProblem } from "@kade/proto/kade/catalog/v1/catalog_service";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import {
  GroupOrder,
  GroupOrderStatus,
  type CreateGroupOrderRequest,
  type GroupMember,
  type OrderLineInput,
} from "@kade/proto/kade/order/v1/order_service";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { CATALOG, type CatalogPort } from "../clients/ports.js";
import { groupOrders } from "../db/schema.js";
import { asDomainError } from "../orders/dependency-errors.js";
import { orderEvents } from "../orders/events.js";
import { formatRs, lkr, minor } from "../orders/money.js";
import { Database, type HasDeadline, type Queryable, type Tx } from "../platform/db/database.js";
import { failedPrecondition, invalidArgument, notFound, permissionDenied } from "../platform/grpc/errors.js";
import { OutboxWriter } from "../platform/outbox/outbox.js";

const MIN_MINUTES = 5;
const MAX_MINUTES = 180;
const DEFAULT_MINUTES = 30;
const MAX_MEMBERS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Group orders: the host shares a link, friends add dishes, the host places one order. */
@Injectable()
export class GroupService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(CATALOG) private readonly catalog: CatalogPort,
  ) {}

  async create(ctx: HasDeadline, req: CreateGroupOrderRequest): Promise<GroupOrder> {
    if (!req.hostCustomerId) throw invalidArgument("CUSTOMER_REQUIRED", "Sign in to start a group order.");
    if (!req.restaurantId) throw invalidArgument("RESTAURANT_REQUIRED", "Choose a restaurant first.");
    const minutes = req.minutes || DEFAULT_MINUTES;
    if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      throw invalidArgument(
        "GROUP_MINUTES_INVALID",
        `Keep the group open for ${MIN_MINUTES}–${MAX_MINUTES} minutes.`,
      );
    }
    if (minor(req.limit) < 0) throw invalidArgument("GROUP_LIMIT_INVALID", "The limit can't be negative.");
    if (req.idempotencyKey) {
      const existing = await this.findOne(this.database.db, {
        host: req.hostCustomerId,
        key: req.idempotencyKey,
      });
      if (existing) return existing;
    }
    let restaurantName: string;
    try {
      const restaurant = await this.catalog.getRestaurant(req.restaurantId);
      if (!restaurant) throw notFound("RESTAURANT_NOT_FOUND", "We couldn't find that restaurant.");
      restaurantName = restaurant.name;
    } catch (err) {
      throw asDomainError(err, "We couldn't start the group right now. Try again in a minute.");
    }
    const now = new Date();
    const group: GroupOrder = {
      id: uuidv7(),
      restaurantId: req.restaurantId,
      restaurantName,
      hostCustomerId: req.hostCustomerId,
      hostName: req.hostName.trim() || "Host",
      createdAt: now,
      closesAt: new Date(now.getTime() + minutes * 60_000),
      limit: minor(req.limit) > 0 ? req.limit : undefined,
      members: [],
      orderId: "",
      status: GroupOrderStatus.GROUP_ORDER_STATUS_OPEN,
      shareToken: randomBytes(9).toString("base64url"),
    };
    return this.database.transaction(ctx, async (tx) => {
      const inserted = await tx
        .insert(groupOrders)
        .values({
          id: group.id,
          shareToken: group.shareToken,
          status: group.status,
          hostCustomerId: group.hostCustomerId,
          restaurantId: group.restaurantId,
          idempotencyKey: req.idempotencyKey || null,
          data: GroupOrder.toJSON(group) as object,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: groupOrders.id });
      if (inserted.length === 0) {
        return (await this.findOne(tx, { host: req.hostCustomerId, key: req.idempotencyKey }))!;
      }
      await this.emit(tx, group, now);
      return group;
    });
  }

  /** Any status (internal use, e.g. the placing host). */
  async findOne(
    db: Queryable,
    by: { id?: string; token?: string; host?: string; key?: string },
  ): Promise<GroupOrder | undefined> {
    const where = by.id
      ? UUID.test(by.id)
        ? eq(groupOrders.id, by.id)
        : undefined
      : by.token
        ? eq(groupOrders.shareToken, by.token)
        : by.host && by.key
          ? and(eq(groupOrders.hostCustomerId, by.host), eq(groupOrders.idempotencyKey, by.key))
          : undefined;
    if (!where) return undefined;
    const [row] = await db.select().from(groupOrders).where(where);
    return row && GroupOrder.fromJSON(row.data);
  }

  /** Open groups only: GROUP_CLOSED once placed or closed. */
  async getOpen(by: { id?: string; token?: string }): Promise<GroupOrder> {
    const group = await this.findOne(this.database.db, by);
    if (!group)
      throw notFound("GROUP_NOT_FOUND", "This group order doesn't exist, or the host has closed it.");
    if (group.status !== GroupOrderStatus.GROUP_ORDER_STATUS_OPEN) {
      throw notFound("GROUP_CLOSED", "This group order has closed.", {
        groupId: group.id,
        orderId: group.orderId,
      });
    }
    return group;
  }

  async join(
    ctx: HasDeadline,
    token: string,
    customerId: string,
    name: string,
  ): Promise<{ group: GroupOrder; memberId: string }> {
    if (!token) throw invalidArgument("SHARE_TOKEN_REQUIRED", "Open the link the host shared.");
    const found = await this.getOpen({ token });
    let memberId = "";
    const group = await this.change(ctx, found.id, (g, now) => {
      if (g.closesAt && g.closesAt.getTime() < now.getTime()) {
        throw failedPrecondition("GROUP_CLOSED", "This group order has closed.");
      }
      if (customerId && customerId === g.hostCustomerId) {
        memberId = "host";
        return false;
      }
      const existing = customerId ? g.members.find((m) => m.customerId === customerId) : undefined;
      if (existing) {
        memberId = existing.id;
        return false;
      }
      if (g.members.length >= MAX_MEMBERS) {
        throw failedPrecondition("GROUP_FULL", `A group order can have up to ${MAX_MEMBERS} people.`);
      }
      const member: GroupMember = {
        id: uuidv7(),
        customerId,
        name: name.trim() || "Guest",
        joinedAt: now,
        lines: [],
        pricedLines: [],
        subtotal: lkr(0),
      };
      g.members.push(member);
      memberId = member.id;
      return true;
    });
    return { group, memberId };
  }

  async setMemberLines(
    ctx: HasDeadline,
    groupId: string,
    memberId: string,
    lines: OrderLineInput[],
  ): Promise<GroupOrder> {
    const current = await this.getOpen({ id: groupId });
    if (!current.members.some((m) => m.id === memberId)) {
      throw notFound("GROUP_MEMBER_NOT_FOUND", "You're no longer in this group.");
    }
    for (const l of lines) {
      if (!l.itemId || l.quantity <= 0)
        throw invalidArgument("LINE_INVALID", "Each dish needs a quantity of 1 or more.");
    }
    const member = current.members.find((m) => m.id === memberId)!;
    const keys = lines.map((l, i) => l.key || `${memberId}-${i + 1}`);
    let priced: GroupMember["pricedLines"] = [];
    if (lines.length > 0) {
      let validation;
      try {
        validation = await this.catalog.validateCart({
          restaurantId: current.restaurantId,
          mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
          lines: lines.map((l, i) => ({
            lineKey: keys[i]!,
            itemId: l.itemId,
            quantity: l.quantity,
            options: l.options,
          })),
        });
      } catch (err) {
        throw asDomainError(err, "We couldn't check the menu right now. Try again in a minute.");
      }
      const problem = validation.lines.find((l) => l.problem !== LineProblem.LINE_PROBLEM_UNSPECIFIED);
      if (problem)
        throw failedPrecondition("ITEM_SOLD_OUT", problem.problemMessage || "A dish is no longer available.");
      const byKey = new Map(validation.lines.map((v) => [v.lineKey, v]));
      priced = lines.map((l, i) => {
        const v = byKey.get(keys[i]!);
        return {
          key: keys[i]!,
          itemId: l.itemId,
          name: v?.name ?? "",
          unitPrice: v?.unitPrice ?? lkr(0),
          quantity: l.quantity,
          options: l.options,
          choiceNames: v?.choiceNames ?? [],
          // The kitchen bags each person's dishes separately.
          note: l.note || `For ${member.name}`,
          sectionId: v?.sectionId ?? "",
        };
      });
    }
    const subtotal = priced.reduce((s, l) => s + minor(l.unitPrice) * l.quantity, 0);
    const limit = minor(current.limit);
    if (limit > 0 && subtotal > limit) {
      throw failedPrecondition(
        "GROUP_LIMIT_EXCEEDED",
        `The host set a limit of ${formatRs(limit)} each. Remove ${formatRs(subtotal - limit)} to stay under it.`,
        { limit: String(limit), subtotal: String(subtotal) },
      );
    }
    return this.change(ctx, groupId, (g) => {
      const m = g.members.find((x) => x.id === memberId);
      if (!m) throw notFound("GROUP_MEMBER_NOT_FOUND", "You're no longer in this group.");
      m.lines = lines.map((l, i) => ({ ...l, key: keys[i]! }));
      m.pricedLines = priced;
      m.subtotal = lkr(subtotal);
      return true;
    });
  }

  async leave(ctx: HasDeadline, groupId: string, memberId: string): Promise<GroupOrder> {
    await this.getOpen({ id: groupId });
    return this.change(ctx, groupId, (g) => {
      const before = g.members.length;
      g.members = g.members.filter((m) => m.id !== memberId);
      return g.members.length !== before;
    });
  }

  async close(
    ctx: HasDeadline,
    groupId: string,
    userId: string | undefined,
    staff: boolean,
  ): Promise<GroupOrder> {
    const group = await this.findOne(this.database.db, { id: groupId });
    if (!group) throw notFound("GROUP_NOT_FOUND", "This group order doesn't exist.");
    if (userId && !staff && userId !== group.hostCustomerId) {
      throw permissionDenied("NOT_GROUP_HOST", "Only the host can close the group.");
    }
    return this.change(ctx, groupId, (g) => {
      if (g.status !== GroupOrderStatus.GROUP_ORDER_STATUS_OPEN) return false;
      g.status = GroupOrderStatus.GROUP_ORDER_STATUS_CLOSED;
      return true;
    });
  }

  /** The host's order was placed (saga step 4): the group is done. Runs in the order's transaction. */
  async markPlaced(tx: Tx, groupId: string, orderId: string): Promise<void> {
    if (!UUID.test(groupId)) return;
    await this.changeIn(tx, groupId, (g) => {
      if (g.status === GroupOrderStatus.GROUP_ORDER_STATUS_PLACED && g.orderId === orderId) return false;
      g.status = GroupOrderStatus.GROUP_ORDER_STATUS_PLACED;
      g.orderId = orderId;
      return true;
    }).catch((err: unknown) => {
      // An unknown group id must not block the order.
      if (err instanceof Error && err.message === "GROUP_NOT_FOUND") return;
      throw err;
    });
  }

  private change(
    ctx: HasDeadline,
    groupId: string,
    fn: (g: GroupOrder, now: Date) => boolean,
  ): Promise<GroupOrder> {
    return this.database.transaction(ctx, (tx) => this.changeIn(tx, groupId, fn));
  }

  private async changeIn(
    tx: Tx,
    groupId: string,
    fn: (g: GroupOrder, now: Date) => boolean,
  ): Promise<GroupOrder> {
    const [row] = await tx.select().from(groupOrders).where(eq(groupOrders.id, groupId)).for("update");
    if (!row) throw new Error("GROUP_NOT_FOUND");
    const group = GroupOrder.fromJSON(row.data);
    const now = new Date();
    if (!fn(group, now)) return group;
    await tx
      .update(groupOrders)
      .set({ status: group.status, data: GroupOrder.toJSON(group) as object, updatedAt: now })
      .where(eq(groupOrders.id, groupId));
    await this.emit(tx, group, now);
    return group;
  }

  private async emit(tx: Tx, group: GroupOrder, at: Date): Promise<void> {
    const event = orderEvents.groupUpdated(group, at);
    await this.outbox.append(tx, {
      aggregateType: "order",
      aggregateId: group.id,
      type: event.type,
      payload: event.payload,
    });
  }
}
