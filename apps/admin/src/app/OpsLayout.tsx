import { AppShell, SearchField } from "@kade/ui";
import { useState, type FormEvent } from "react";
import { Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";
import { ME } from "@/api/client";
import { isLive } from "@/api/config";
import { useLive, useTickets } from "@/api/queries";
import { formatClock, formatDay } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { navItems, titleFor } from "./nav";
import styles from "./OpsLayout.module.css";

export function OpsLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const now = useNow(15_000);
  const live = useLive(true);
  const tickets = useTickets();
  const [query, setQuery] = useState("");

  const late = live.data?.attention.filter((a) => a.kind === "lateOrder").length ?? 0;
  const urgentTickets =
    tickets.data?.filter((t) => t.status !== "resolved" && (t.priority === "urgent" || t.slaDueAt < now))
      .length ?? 0;
  const nav = navItems.map((n) => ({
    ...n,
    badge: n.href === "/orders" ? late : n.href === "/support" ? urgentTickets : undefined,
  }));

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    // Search text goes in router state, not the URL, so names and phone numbers stay out of history
    navigate("/orders", { state: { q: query.trim() } });
    setQuery("");
  };

  return (
    <>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <AppShell
        product="Ops"
        nav={nav}
        currentPath={pathname}
        // Phones get the page name in the top bar; wider screens already show the page's own heading
        title={<span className={styles.shellTitle}>{titleFor(pathname)}</span>}
        account={
          <div className={styles.account}>
            <span className={styles.avatar} aria-hidden="true">
              {ME.name.slice(0, 1)}
            </span>
            <span>
              <strong>{ME.name}</strong>
              <span>{ME.title}</span>
              {isLive && (
                <button
                  type="button"
                  className={styles.signOut}
                  onClick={() => void import("@/api/gateway/auth").then((a) => a.signOut())}
                >
                  Sign out
                </button>
              )}
            </span>
          </div>
        }
        topBar={
          <>
            <form onSubmit={onSearch} className={styles.search}>
              <SearchField
                label="Find an order, customer, restaurant or rider"
                placeholder="Find an order, customer or rider"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </form>
            <p className={styles.clock}>
              <span className={styles.city}>Colombo</span>
              <time>
                {formatDay(now)}, {formatClock(now)}
              </time>
            </p>
          </>
        }
      >
        <Outlet />
      </AppShell>
      <ScrollRestoration />
    </>
  );
}
