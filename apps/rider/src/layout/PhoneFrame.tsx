import type { ReactNode } from "react";
import styles from "./PhoneFrame.module.css";

/** A phone-width column, centred on wider screens so the app still reads as a phone app. */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.phone}>{children}</div>
    </div>
  );
}
