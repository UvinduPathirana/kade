// Group orders. Later: the order service's group endpoints (POST /groups, GET /groups/:id) with
// friends joining from the shared link. Today a mock: three friends join on a timer and add dishes.
import { getMenu, getRestaurant } from "./catalog";
import type { GroupMember, GroupOrder, MenuItem, OrderLine } from "./types";

const KEY = "kade.groups.v1";

export class GroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupError";
  }
}

const latency = () => new Promise((r) => setTimeout(r, 350));

function readAll(): GroupOrder[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as GroupOrder[];
  } catch {
    return [];
  }
}

const writeAll = (groups: GroupOrder[]) => localStorage.setItem(KEY, JSON.stringify(groups));

const line = (item: MenuItem, qty: number, who: string): OrderLine => ({
  key: `${item.id}|For ${who}`,
  itemId: item.id,
  name: item.name,
  unitPrice: item.price,
  qty,
  choices: [],
  // The kitchen bags each person's dishes separately
  note: `For ${who}`,
});

export interface CreateGroupInput {
  restaurantId: number;
  hostName: string;
  /** Minutes until the group closes. */
  minutes: number;
  limit?: number;
}

export async function createGroup(input: CreateGroupInput): Promise<GroupOrder> {
  await latency();
  const restaurant = await getRestaurant(input.restaurantId);
  const menu = await getMenu(input.restaurantId);
  // Friends pick from the dishes without options, the way most people order in a group
  const dishes = menu.sections
    .flatMap((s) => s.items)
    .filter((it) => !it.soldOut && !it.optionGroupIds.length);
  const pick = (i: number) => dishes[i % Math.max(1, dishes.length)] ?? menu.popular[0]!;
  const members: GroupMember[] = [
    { name: "Ishara", joinsAfter: 6_000, lines: [line(pick(0), 1, "Ishara"), line(pick(3), 1, "Ishara")] },
    { name: "Ravi", joinsAfter: 14_000, lines: [line(pick(1), 2, "Ravi")] },
    { name: "Fathima", joinsAfter: 24_000, lines: [line(pick(2), 1, "Fathima")] },
  ];
  const now = Date.now();
  const group: GroupOrder = {
    id: `G${Math.floor(10000 + Math.random() * 90000)}`,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    hostName: input.hostName.trim() || "You",
    createdAt: now,
    closesAt: now + input.minutes * 60_000,
    limit: input.limit,
    members,
  };
  writeAll([group, ...readAll()]);
  return group;
}

export async function getGroup(id: string): Promise<GroupOrder> {
  const group = readAll().find((g) => g.id === id);
  if (!group) throw new GroupError("This group order doesn't exist, or the host has closed it.");
  return group;
}

/** Called by the order service when the host places the group's order. */
export function markGroupPlaced(id: string, orderId: string) {
  writeAll(readAll().map((g) => (g.id === id ? { ...g, orderId } : g)));
}

/** People who have joined by `now`. */
export const joinedMembers = (g: GroupOrder, now: number) =>
  g.members.filter((m) => now - g.createdAt >= m.joinsAfter);
