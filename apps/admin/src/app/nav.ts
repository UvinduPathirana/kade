import type { NavItem } from "@kade/ui";

/** Sidebar order follows a shift: watch, act on orders, then the back office. */
export const navItems: Omit<NavItem, "badge">[] = [
  { href: "/", label: "Live", icon: "map", primary: true },
  { href: "/orders", label: "Orders", icon: "receipt", primary: true },
  { href: "/support", label: "Support", icon: "chat", primary: true },
  { href: "/riders", label: "Riders", icon: "bike", primary: true },
  { href: "/restaurants", label: "Restaurants", icon: "store", primary: true },
  { href: "/customers", label: "Customers", icon: "users" },
  { href: "/finance", label: "Finance", icon: "wallet" },
  { href: "/zones", label: "Zones and pricing", icon: "pin" },
  { href: "/promotions", label: "Promotions", icon: "tag" },
  { href: "/content", label: "Home feed", icon: "image" },
  { href: "/team", label: "Team and audit", icon: "shield" },
];

export function titleFor(path: string): string {
  const match = navItems.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));
  return match?.label ?? "Page not found";
}
