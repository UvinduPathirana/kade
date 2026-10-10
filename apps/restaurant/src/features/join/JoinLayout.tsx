import { Link } from "@kade/ui";
import type { ReactNode } from "react";
import styles from "./JoinLayout.module.css";

/** Frame for pages outside the signed-in app: partner sign-up and the signed-out screen. */
export function JoinLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <Link href="/join" className={styles.brand} aria-label="Kadé for restaurants, partner sign-up">
          <span className={styles.wordmark}>kadé</span>
          <span className={styles.product}>for restaurants</span>
        </Link>
        <p className={styles.signIn}>
          Already a partner? <Link href="/">Sign in</Link>
        </p>
      </header>
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
