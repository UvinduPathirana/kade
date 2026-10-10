import { Icon, Link, Tag, cx, type IconName } from "@kade/ui";
import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { OfferCard } from "@/features/job/OfferCard";
import { jobPath, useJob, type Phase } from "@/features/job/store";
import { useDispatchLoop } from "@/features/job/useDispatchLoop";
import { PhoneFrame } from "./PhoneFrame";
import styles from "./RiderLayout.module.css";

const STATUS: Record<Phase, { label: string; tone: "live" | "neutral" | "dark" }> = {
  offline: { label: "Offline", tone: "neutral" },
  online: { label: "Online", tone: "live" },
  offer: { label: "Online", tone: "live" },
  pickup: { label: "On a job", tone: "dark" },
  dropoff: { label: "On a job", tone: "dark" },
  delivered: { label: "Online", tone: "live" },
};

const isActive = (current: string, href: string, also?: string) =>
  href === "/" ? current === "/" || (!!also && current.startsWith(also)) : current.startsWith(href);

/**
 * The signed-in app: a phone-width column (centred on desktop) with a slim status bar on top, the
 * page in the middle and four thumb-reach tabs at the bottom. The job offer covers all of it.
 */
export function RiderLayout() {
  useDispatchLoop();
  const { pathname } = useLocation();
  const phase = useJob((s) => s.phase);
  const status = STATUS[phase];
  const onJob = jobPath(phase);
  const offerShowing = phase === "offer";
  const mainRef = useRef<HTMLElement>(null);

  // The page scrolls inside the phone column, not the window, so reset it on navigation
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  const tabs: { href: string; label: string; icon: IconName }[] = [
    { href: onJob ?? "/", label: onJob ? "Job" : "Drive", icon: onJob ? "navigation" : "bike" },
    { href: "/earnings", label: "Earnings", icon: "wallet" },
    { href: "/trips", label: "Trips", icon: "receipt" },
    { href: "/account", label: "Account", icon: "user" },
  ];

  return (
    <PhoneFrame>
      <div className={styles.app} inert={offerShowing}>
        <header className={styles.top}>
          <Link href="/" className={styles.brand} aria-label="Kadé Rider home">
            <span className={styles.wordmark}>kadé</span>
            <span className={styles.product}>Rider</span>
          </Link>
          <Tag tone={status.tone} size="md">
            {status.label}
          </Tag>
        </header>

        <main id="main" ref={mainRef} className={styles.main}>
          <Outlet />
        </main>

        <nav aria-label="Main" className={styles.tabs}>
          {tabs.map((t, i) => {
            const active = isActive(pathname, t.href, i === 0 ? "/job" : undefined);
            return (
              <Link
                key={t.label}
                href={t.href}
                className={cx(styles.tab, active && styles.tabActive)}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={t.icon} size={24} />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {offerShowing && <OfferCard />}
    </PhoneFrame>
  );
}
