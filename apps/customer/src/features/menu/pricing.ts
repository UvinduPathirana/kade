import type { MenuItem, OptionGroup } from "@/api/types";

/** Selected choice indexes per option group. */
export type Selection = Record<string, number[]>;

/** Price of one dish including the paid options chosen. */
export function unitPriceFor(item: MenuItem, groups: Record<string, OptionGroup>, sel: Selection): number {
  return item.optionGroupIds.reduce(
    (sum, gid) => sum + (sel[gid] ?? []).reduce((s, i) => s + (groups[gid]?.choices[i]?.price ?? 0), 0),
    item.price,
  );
}
