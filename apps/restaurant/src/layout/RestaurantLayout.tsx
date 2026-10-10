import { AppShell, Tag, type NavItem } from "@kade/ui";
import { Outlet, ScrollRestoration, useLocation, useMatches } from "react-router";
import { isPaused } from "@/api/outlet";
import { useOutlet, useTickets } from "@/api/queries";
import { useAnnouncer } from "@/features/alerts/announcer";
import { useOrderAlerts } from "@/features/alerts/useOrderAlerts";
import { useNow } from "@/lib/time";
import { TopBarControls } from "./TopBarControls";
import styles from "./RestaurantLayout.module.css";

export interface RouteHandle {
  title: string;
}

/** The signed-in frame: ink sidebar so the orders read, and the order alerts that ring on every page. */
export function RestaurantLayout() {
  const { pathname } = useLocation();
  const matches = useMatches();
  const title = (matches.at(-1)?.handle as RouteHandle | undefined)?.title;
  const now = useNow(1000);
  const { data: tickets } = useTickets();
  const { data: outlet } = useOutlet();
  const message = useAnnouncer((s) => s.message);
  const seq = useAnnouncer((s) => s.seq);
  useOrderAlerts(tickets, now);

  const waiting = tickets?.filter((t) => t.status === "new").length ?? 0;
  const nav: NavItem[] = [
    { href: "/", label: "Live orders", shortLabel: "Orders", icon: "bell", badge: waiting, primary: true },
    { href: "/menu", label: "Menu", icon: "menu", primary: true },
    { href: "/hours", label: "Hours and busy mode", shortLabel: "Hours", icon: "clock", primary: true },
    { href: "/promotions", label: "Promotions", icon: "megaphone" },
    { href: "/payouts", label: "Sales and payouts", shortLabel: "Payouts", icon: "wallet", primary: true },
    { href: "/reviews", label: "Reviews", icon: "star" },
    {
      href: "/settings",
      label: "Staff and settings",
      shortLabel: "Settings",
      icon: "settings",
      primary: true,
    },
  ];
  const paused = outlet ? isPaused(outlet.status, now) : false;

  return (
    <>
      <AppShell
        tone="ink"
        product="for restaurants"
        nav={nav}
        currentPath={pathname}
        title={title}
        topBar={<TopBarControls ordersWaiting={waiting > 0} now={now} />}
        account={
          <div className={styles.account}>
            <strong>Galle Road Kottu House</strong>
            <span>Kollupitiya</span>
            <Tag tone={paused ? "warning" : "live"} className={styles.status}>
              {paused ? "Paused" : "Taking orders"}
            </Tag>
          </div>
        }
      >
        <Outlet />
      </AppShell>
      <div className="kd-visually-hidden" aria-live="assertive" aria-atomic="true">
        <span key={seq}>{message}</span>
      </div>
      <ScrollRestoration />
    </>
  );
}
