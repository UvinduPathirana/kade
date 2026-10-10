import type { ReactNode } from "react";
import { Icon, type IconName } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import { Link } from "../../lib/link";
import styles from "./AppShell.module.css";

export interface NavItem {
  href: string;
  label: string;
  /** Shorter label for the phone bottom bar, where space is tight ("Hours" for "Hours and busy mode"). */
  shortLabel?: string;
  icon: IconName;
  /** Count shown on the item, e.g. new orders or open tickets. */
  badge?: number;
  /** Show this item in the phone bottom bar (max 5). */
  primary?: boolean;
}

export interface AppShellProps {
  /** Product name next to the wordmark: "for restaurants", "Rider", "Ops". */
  product: string;
  nav: NavItem[];
  /** Current path, so the shell can mark the active item without importing a router. */
  currentPath: string;
  /** Who is signed in / which outlet, shown at the foot of the sidebar. */
  account?: ReactNode;
  /** Right side of the top bar: status toggles, search, notifications. */
  topBar?: ReactNode;
  /** Page title in the top bar on phones and tablets. */
  title?: ReactNode;
  /** ink: dark sidebar for always-on screens (kitchen tablet). light: default. */
  tone?: "light" | "ink";
  children: ReactNode;
}

const isActive = (current: string, href: string) =>
  href === "/" ? current === "/" : current === href || current.startsWith(`${href}/`);

/**
 * Frame for the operations apps (restaurant, rider, admin). Desktop: labelled sidebar. Tablet: icon rail.
 * Phone: top bar + bottom tabs for items marked `primary`.
 */
export function AppShell({
  product,
  nav,
  currentPath,
  account,
  topBar,
  title,
  tone = "light",
  children,
}: AppShellProps) {
  const primary = nav.filter((n) => n.primary).slice(0, 5);
  return (
    <div className={cx(styles.shell, styles[tone])}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.brand} aria-label={`Kadé ${product} home`}>
          <span className={styles.wordmark}>kadé</span>
          <span className={styles.product}>{product}</span>
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          {nav.map((n) => {
            const active = isActive(currentPath, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cx(styles.item, active && styles.active)}
                aria-current={active ? "page" : undefined}
                title={n.label}
              >
                <Icon name={n.icon} />
                <span className={styles.itemLabel}>{n.label}</span>
                {!!n.badge && <span className={styles.badge}>{n.badge}</span>}
              </Link>
            );
          })}
        </nav>
        {account && <div className={styles.account}>{account}</div>}
      </aside>

      <div className={styles.main}>
        {(topBar || title) && (
          <header className={styles.topBar}>
            <div className={styles.topTitle}>{title}</div>
            <div className={styles.topActions}>{topBar}</div>
          </header>
        )}
        <main id="main" className={styles.content}>
          {children}
        </main>
      </div>

      {primary.length > 0 && (
        <nav aria-label="Main" className={styles.bottomBar}>
          {primary.map((n) => {
            const active = isActive(currentPath, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cx(styles.bottomItem, active && styles.bottomActive)}
                aria-current={active ? "page" : undefined}
              >
                <span className={styles.bottomIcon}>
                  <Icon name={n.icon} />
                  {!!n.badge && <span className={styles.bottomBadge}>{n.badge}</span>}
                </span>
                {n.shortLabel ?? n.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
