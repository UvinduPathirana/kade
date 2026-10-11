// Menu editing over gateway-merchant (catalog MenuManagementService). Every change answers with the menu.
import { del, enc, get, post, put } from "../http";
import type { Menu, MenuItemInput } from "../types";

export const getMenu = () => get<Menu>("/v1/menu");

export const setSoldOut = (itemId: string, soldOut: boolean) =>
  put<Menu>(`/v1/menu/items/${enc(itemId)}/sold-out`, { soldOut });

export const saveItem = (input: MenuItemInput) => post<Menu>("/v1/menu/items", input);

export const deleteItem = (itemId: string) => del<Menu>(`/v1/menu/items/${enc(itemId)}`);

export const moveSection = (sectionId: string, direction: -1 | 1) =>
  post<Menu>(`/v1/menu/sections/${enc(sectionId)}/move`, { direction });

export const addSection = (name: string) => post<Menu>("/v1/menu/sections", { name: name.trim() });
