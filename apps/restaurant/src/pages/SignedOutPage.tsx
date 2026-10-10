import { Button, Link } from "@kade/ui";
import { JoinLayout } from "@/features/join/JoinLayout";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./JoinStatusPage.module.css";

/** Where "Sign out" lands. Phone sign-in comes with the partner service; for now this signs straight back in. */
export function SignedOutPage() {
  useDocumentTitle("Signed out");
  return (
    <JoinLayout>
      <div className={styles.page}>
        <h1 className={styles.title}>You're signed out of this tablet</h1>
        <p className={styles.lead}>New orders won't ring here until someone signs in again.</p>
        <Button href="/" size="lg">
          Sign in to Galle Road Kottu House
        </Button>
        <p className={styles.help}>
          Not a partner yet? <Link href="/join">Apply to sell on Kadé</Link>
        </p>
      </div>
    </JoinLayout>
  );
}
