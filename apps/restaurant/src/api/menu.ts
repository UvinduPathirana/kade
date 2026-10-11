// Menu API. Live: gateway-merchant (catalog MenuManagementService). Mock: localStorage.
// Changes here are what customers see on the restaurant page.
import { liveFor } from "./config";
import * as live from "./live/menu";
import * as mock from "./mock/menu";

// The mock must answer exactly like the live service.
const impl: typeof live = liveFor("menu") ? live : mock;

export const { getMenu, setSoldOut, saveItem, deleteItem, moveSection, addSection } = impl;
