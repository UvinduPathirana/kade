import { Button, EmptyState, Icon, plural } from "@kade/ui";
import { useState, type ReactNode } from "react";
import { isPaused } from "@/api/outlet";
import { useOutlet, useSetPause, useTickets } from "@/api/queries";
import type { Ticket } from "@/api/types";
import { unlockAudio, playNewOrder } from "@/features/alerts/sound";
import { useSound } from "@/features/alerts/store";
import { DoneRow, PreparingCard, ReadyCard, WaitingCard } from "@/features/board/LaneCards";
import { NewOrderAlert } from "@/features/board/NewOrderAlert";
import { clockTime, useNow } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./BoardPage.module.css";

const by = (key: (t: Ticket) => number) => (a: Ticket, b: Ticket) => key(a) - key(b);

/**
 * The live orders board. New orders take the top of the screen on the turmeric card; below,
 * three lanes follow the order through the kitchen: preparing, ready, picked up.
 */
export function BoardPage() {
  const now = useNow(1000);
  const { data: tickets, isPending, isError, refetch } = useTickets();
  const { data: outlet } = useOutlet();
  const [shownId, setShownId] = useState<string | null>(null);
  const waiting = (tickets ?? []).filter((t) => t.status === "new").sort(by((t) => t.acceptBy));
  useDocumentTitle(waiting.length ? `(${waiting.length}) Live orders` : "Live orders");

  if (isPending) return <p className={styles.loading}>Loading orders…</p>;
  if (isError)
    return (
      <EmptyState
        title="Orders didn't load"
        description="Check the tablet's Wi-Fi. New orders can't reach you until this works."
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    );

  const preparing = tickets.filter((t) => t.status === "preparing").sort(by((t) => t.readyBy ?? 0));
  const ready = tickets.filter((t) => t.status === "ready").sort(by((t) => t.readyAt ?? 0));
  const done = tickets
    .filter((t) => t.status === "pickedUp" || t.status === "missed" || t.status === "rejected")
    .sort(by((t) => -(t.closedAt ?? 0)));
  const missedCount = done.filter((t) => t.status === "missed").length;
  const shown = waiting.find((t) => t.id === shownId) ?? waiting[0];
  const queue = waiting.filter((t) => t !== shown);
  const busyExtra = outlet?.status.busyExtra ?? 0;

  return (
    <div className={styles.board}>
      <h1 className="kd-visually-hidden">Live orders</h1>
      <SoundNotice hasWaiting={waiting.length > 0} />
      {outlet && isPaused(outlet.status, now) && <PausedNotice until={outlet.status.pausedUntil!} />}

      <section aria-labelledby="new-heading" className={styles.newZone}>
        <h2 id="new-heading" className="kd-visually-hidden">
          New orders, {waiting.length}
        </h2>
        {shown ? (
          <div className={queue.length ? styles.newGrid : undefined}>
            <NewOrderAlert key={shown.id} ticket={shown} now={now} busyExtra={busyExtra} />
            {queue.length > 0 && (
              <div className={styles.queue}>
                <p className={styles.queueTitle}>Also waiting, {queue.length}</p>
                <ul className={styles.queueList}>
                  {queue.map((t) => (
                    <WaitingCard key={t.id} ticket={t} now={now} onShow={() => setShownId(t.id)} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.quiet}>
            <Icon name="bell" size={28} />
            <p>
              <strong>No new orders right now.</strong> When one comes in it rings and appears here, with 3
              minutes to accept.
            </p>
          </div>
        )}
      </section>

      <div className={styles.lanes}>
        <Lane title="Preparing" count={preparing.length}>
          {preparing.length ? (
            <ul className={styles.cards}>
              {preparing.map((t) => (
                <li key={t.id}>
                  <PreparingCard ticket={t} now={now} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Nothing cooking. Accepted orders show here with their prep timer.</p>
          )}
        </Lane>

        <Lane title="Ready" count={ready.length}>
          {ready.length ? (
            <ul className={styles.cards}>
              {ready.map((t) => (
                <li key={t.id}>
                  <ReadyCard ticket={t} now={now} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>
              Orders you mark ready wait here until the rider or customer takes them.
            </p>
          )}
        </Lane>

        <Lane
          title="Picked up"
          count={done.length - missedCount}
          note={missedCount > 0 ? `${plural(missedCount, "missed order")} in the last hour` : undefined}
        >
          {done.length ? (
            <ul className={styles.doneList}>
              {done.map((t) => (
                <DoneRow key={t.id} ticket={t} />
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Orders leave the board an hour after pickup.</p>
          )}
        </Lane>
      </div>
    </div>
  );
}

function Lane({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count: number;
  note?: string;
  children: ReactNode;
}) {
  const id = `lane-${title.toLowerCase().replace(/\s/g, "-")}`;
  return (
    <section aria-labelledby={id} className={styles.lane}>
      <header className={styles.laneHead}>
        <h2 id={id} className={styles.laneTitle}>
          {title}
          <span className={styles.laneCount}>{count}</span>
        </h2>
        {note && <p className={styles.laneNote}>{note}</p>}
      </header>
      {children}
    </section>
  );
}

/** Says plainly that the browser is blocking sound, and fixes it with one tap. */
function SoundNotice({ hasWaiting }: { hasWaiting: boolean }) {
  const { soundOn, unlocked, setUnlocked } = useSound();
  if (!soundOn || unlocked) return null;
  return (
    <div className={styles.notice} role="note">
      <Icon name="alert" size={24} />
      <p>
        <strong>New orders won't ring yet.</strong> The browser blocks sound until someone taps the screen.
      </p>
      <Button
        variant="ink"
        size="lg"
        icon="bell"
        onClick={async () => {
          const ok = await unlockAudio();
          setUnlocked(ok);
          if (ok && hasWaiting) playNewOrder();
        }}
      >
        Turn on sound
      </Button>
    </div>
  );
}

function PausedNotice({ until }: { until: number }) {
  const setPause = useSetPause();
  return (
    <div className={styles.notice} role="note">
      <Icon name="pause" size={24} />
      <p>
        <strong>Store paused until {clockTime(until)}.</strong> Customers can't order until then.
      </p>
      <Button
        variant="ink"
        size="lg"
        icon="play"
        onClick={() => setPause.mutate(null)}
        disabled={setPause.isPending}
      >
        Resume orders
      </Button>
    </div>
  );
}
