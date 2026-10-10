import { Icon, type IconName } from "@kade/ui";
import { NavLink } from "react-router";
import { useSession } from "@/features/account/session";
import styles from "./TabBar.module.css";

/** Bottom navigation on phones (below 640px). */
export function TabBar() {
  const signedIn = useSession((s) => !!s.user);
  const tabs: { to: string; label: string; icon: IconName }[] = [
    { to: "/", label: "Home", icon: "home" },
    { to: "/browse", label: "Browse", icon: "grid" },
    { to: "/orders", label: "Orders", icon: "receipt" },
    signedIn
      ? { to: "/account", label: "Account", icon: "user" }
      : { to: "/signin", label: "Sign in", icon: "user" },
  ];
  return (
    <nav className={styles.bar} aria-label="Main">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end className={styles.tab}>
          <Icon name={t.icon} />
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
