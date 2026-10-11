import type { Menu, SelectedOption } from "@kade/proto/kade/catalog/v1/catalog_service";

/**
 * The app keeps a dish's chosen options as names in menu order (["Sri Lankan hot", "Extra egg"]);
 * services want (option_group_id, choice_id) pairs. Resolves the names against the item's option
 * groups. Throws OptionError when a name no longer exists on the menu.
 */
export class OptionError extends Error {
  override name = "OptionError";
}

export function selectedOptions(menu: Menu, itemId: string, choiceNames: string[]): SelectedOption[] {
  if (!choiceNames.length) return [];
  const item = [...menu.sections.flatMap((s) => s.items), ...menu.popular].find((i) => i.id === itemId);
  if (!item) throw new OptionError(`A dish in your cart is no longer on the menu.`);
  const groups = item.optionGroupIds.flatMap((id) => menu.optionGroups.find((g) => g.id === id) ?? []);
  const used = new Set<string>();
  return choiceNames.map((name) => {
    for (const g of groups) {
      const choice = g.choices.find((c) => c.name === name && !used.has(`${g.id}/${c.id}`));
      if (choice) {
        used.add(`${g.id}/${choice.id}`);
        return { optionGroupId: g.id, choiceId: choice.id };
      }
    }
    throw new OptionError(
      `"${name}" is no longer available for ${item.name}. Remove it and add the dish again.`,
    );
  });
}
