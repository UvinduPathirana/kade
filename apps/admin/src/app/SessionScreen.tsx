import { Button } from "@kade/ui";
import { signIn, signOut } from "@/api/gateway/auth";
import styles from "./SessionScreen.module.css";

/** Full-page states before the console can open: no staff role, or sign-in unreachable. */
export function SessionScreen({ kind }: { kind: "noAccess" | "error" }) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>Kadé Ops</p>
        {kind === "noAccess" ? (
          <>
            <h1>This account isn’t on the Kadé team</h1>
            <p>
              Kadé Ops is for staff with an ops, finance, support or admin role. Sign in with your @kade.lk
              account, or ask an admin to invite you.
            </p>
            <Button onClick={() => void signOut()}>Sign in with another account</Button>
          </>
        ) : (
          <>
            <h1>Can’t reach sign-in</h1>
            <p>Kadé’s sign-in service isn’t responding. Check your connection, then try again.</p>
            <Button onClick={() => void signIn("/")}>Try again</Button>
          </>
        )}
      </div>
    </main>
  );
}
