// Mock menu service (VITE_API_MODE=mock), kept in localStorage. Live: catalog via gateway-merchant.
// Changes here are what customers see on the restaurant page.
import { latency, readJson, ServiceError, writeJson } from "../storage";
import type { Menu, MenuItem, MenuItemInput } from "../types";
import { seedMenu } from "./menuSeed";

const KEY = "kade.partner.menu.v1";

const read = () => readJson<Menu>(KEY, seedMenu);

function save(change: (menu: Menu) => void): Menu {
  const menu = read();
  change(menu);
  writeJson(KEY, menu);
  return structuredClone(menu);
}

export async function getMenu(): Promise<Menu> {
  await latency(150);
  return structuredClone(read());
}

/** Synchronous read for the order simulation, which builds orders from the live menu. */
export const readMenuNow = (): Menu => read();

export async function setSoldOut(itemId: string, soldOut: boolean): Promise<Menu> {
  await latency(150);
  return save((menu) => {
    const item = menu.sections.flatMap((s) => s.items).find((i) => i.id === itemId);
    if (!item) throw new ServiceError("This dish is no longer on the menu.");
    item.soldOut = soldOut;
  });
}

/** Creates the item when it has no id; otherwise updates it and moves it if the section changed. */
export async function saveItem(input: MenuItemInput): Promise<Menu> {
  await latency();
  return save((menu) => {
    const { sectionId, id, ...fields } = input;
    const target = menu.sections.find((s) => s.id === sectionId);
    if (!target) throw new ServiceError("Choose a section for this dish.");
    if (!id) {
      const item: MenuItem = { ...fields, id: `1-new-${Date.now().toString(36)}`, soldOut: false };
      target.items.push(item);
      return;
    }
    const from = menu.sections.find((s) => s.items.some((i) => i.id === id));
    if (!from) throw new ServiceError("This dish is no longer on the menu.");
    const index = from.items.findIndex((i) => i.id === id);
    const updated = { ...from.items[index]!, ...fields };
    if (from === target) from.items[index] = updated;
    else {
      from.items.splice(index, 1);
      target.items.push(updated);
    }
  });
}

export async function deleteItem(itemId: string): Promise<Menu> {
  await latency();
  return save((menu) => {
    for (const s of menu.sections) s.items = s.items.filter((i) => i.id !== itemId);
  });
}

export async function moveSection(sectionId: string, direction: -1 | 1): Promise<Menu> {
  await latency(100);
  return save((menu) => {
    const i = menu.sections.findIndex((s) => s.id === sectionId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= menu.sections.length) return;
    [menu.sections[i], menu.sections[j]] = [menu.sections[j]!, menu.sections[i]!];
  });
}

export async function addSection(name: string): Promise<Menu> {
  await latency();
  return save((menu) => {
    if (menu.sections.some((s) => s.name.toLowerCase() === name.trim().toLowerCase()))
      throw new ServiceError(`There's already a section called ${name.trim()}.`);
    menu.sections.push({ id: `s-${Date.now().toString(36)}`, name: name.trim(), items: [] });
  });
}
