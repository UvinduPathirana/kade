// Group orders. Live mode: the order service's group orders through the customer gateway (friends
// join from the shared link). Mock mode: three friends join on a timer and add dishes.
import { IS_LIVE } from "./config";
import { GroupError } from "./errors";
import * as live from "./live/group";
import { getMenu, getRestaurant } from "./catalog";
import type { GroupMember, GroupOrder, MenuItem, OrderLine } from "./types";

export { GroupError };

const KEY = "kade.groups.v1";

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

async function mockCreateGroup(input: CreateGroupInput): Promise<GroupOrder> {
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

async function mockGetGroup(id: string): Promise<GroupOrder> {
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

export const createGroup = IS_LIVE ? live.createGroup : mockCreateGroup;
export const getGroup = IS_LIVE ? live.getGroup : mockGetGroup;
