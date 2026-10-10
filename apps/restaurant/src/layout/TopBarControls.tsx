import { Icon, Link, cx } from "@kade/ui";
import { isPaused } from "@/api/outlet";
import { useOutlet, useSetBusy } from "@/api/queries";
import { SoundControl } from "@/features/alerts/SoundControl";
import { clockTime } from "@/lib/time";
import styles from "./TopBarControls.module.css";

/** Right side of the top bar on every page: store status, busy mode shortcut, sound. */
export function TopBarControls({ ordersWaiting, now }: { ordersWaiting: boolean; now: number }) {
  const { data: outlet } = useOutlet();
  const setBusy = useSetBusy();
  const status = outlet?.status;
  const paused = status ? isPaused(status, now) : false;
  const busy = !!status?.busyExtra;

  return (
    <div className={styles.controls}>
      {paused && status?.pausedUntil && (
        <Link href="/hours" className={styles.paused}>
          <Icon name="pause" size={20} />
          <span>
            Paused <span className={styles.wide}>until {clockTime(status.pausedUntil)}</span>
          </span>
        </Link>
      )}
      <button
        type="button"
        aria-pressed={busy}
        disabled={!status || setBusy.isPending}
        className={cx(styles.busy, busy && styles.busyOn)}
        onClick={() => setBusy.mutate(busy ? 0 : 10)}
        title="Adds extra minutes to every new order's prep time"
      >
        <Icon name="timer" size={22} />
        <span className={styles.text}>{busy ? `Busy, +${status?.busyExtra} min` : "Busy mode"}</span>
      </button>
      <SoundControl ordersWaiting={ordersWaiting} />
    </div>
  );
}
