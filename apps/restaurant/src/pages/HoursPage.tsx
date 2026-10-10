import {
  Button,
  EmptyState,
  IconButton,
  Panel,
  SegmentedControl,
  Select,
  Switch,
  TextField,
  useToast,
} from "@kade/ui";
import { useState } from "react";
import { isPaused } from "@/api/outlet";
import { todayIso } from "@/api/promotions";
import {
  useAddClosure,
  useOutlet,
  useRemoveClosure,
  useSaveHours,
  useSetBusy,
  useSetPause,
} from "@/api/queries";
import type { Closure, DayHours, Outlet, Weekday } from "@/api/types";
import { clockTime, shortDate, useNow } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./HoursPage.module.css";

const dayNames: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function HoursPage() {
  useDocumentTitle("Hours and busy mode");
  const { data: outlet, isPending, isError, refetch } = useOutlet();
  if (isPending) return <p className={styles.muted}>Loading hours…</p>;
  if (isError)
    return (
      <EmptyState
        title="Hours didn't load"
        description="Check the tablet's connection and try again."
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    );
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Hours and busy mode</h1>
      <div className={styles.now}>
        <PausePanel outlet={outlet} />
        <BusyPanel outlet={outlet} />
      </div>
      <WeeklyHours key={JSON.stringify(outlet.hours)} hours={outlet.hours} />
      <Closures closures={outlet.closures} />
    </div>
  );
}

// ---------- Right now ----------

/** Next opening time after today, for "until tomorrow". */
function tomorrowOpening(outlet: Outlet) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const day = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[d.getDay()]!;
  const [h, m] = (outlet.hours.find((x) => x.day === day)?.ranges[0]?.open ?? "11:00").split(":").map(Number);
  d.setHours(h ?? 11, m ?? 0, 0, 0);
  return d.getTime();
}

function PausePanel({ outlet }: { outlet: Outlet }) {
  const toast = useToast();
  const now = useNow(15_000);
  const setPause = useSetPause();
  const paused = isPaused(outlet.status, now);

  const pause = (until: number) =>
    setPause.mutate(until, {
      onSuccess: () =>
        toast({
          title: "Store paused",
          description: `Customers can't order until ${clockTime(until)}.`,
          action: { label: "Undo", onClick: () => setPause.mutate(null) },
        }),
    });

  return (
    <Panel title="Pause new orders" titleId="pause-title" className={styles.panel} id="pause">
      {paused ? (
        <div className={styles.paused}>
          <p className={styles.big}>Paused until {clockTime(outlet.status.pausedUntil!)}</p>
          <p className={styles.muted}>Orders already accepted carry on as normal.</p>
          <Button
            size="lg"
            icon="play"
            disabled={setPause.isPending}
            onClick={() =>
              setPause.mutate(null, { onSuccess: () => toast({ title: "Orders resumed", tone: "success" }) })
            }
          >
            Resume orders
          </Button>
        </div>
      ) : (
        <>
          <p className={styles.muted}>
            For a gas cylinder change or a rush you can't keep up with. Customers see you as closed until
            then.
          </p>
          <div className={styles.pauseGrid}>
            {[15, 30, 60].map((m) => (
              <Button
                key={m}
                variant="secondary"
                size="lg"
                disabled={setPause.isPending}
                onClick={() => pause(Date.now() + m * 60_000)}
              >
                {m === 60 ? "1 hour" : `${m} min`}
              </Button>
            ))}
            <Button
              variant="secondary"
              size="lg"
              disabled={setPause.isPending}
              onClick={() => pause(tomorrowOpening(outlet))}
            >
              Until tomorrow
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function BusyPanel({ outlet }: { outlet: Outlet }) {
  const toast = useToast();
  const setBusy = useSetBusy();
  return (
    <Panel title="Busy mode" titleId="busy-title" className={styles.panel}>
      <p className={styles.muted}>Adds time to every new order's prep, so customers see an honest wait.</p>
      <SegmentedControl
        label="Extra prep time"
        variant="card"
        className={styles.busy}
        value={String(outlet.status.busyExtra) as "0" | "10" | "20"}
        onChange={(v) =>
          setBusy.mutate(Number(v) as 0 | 10 | 20, {
            onSuccess: () =>
              toast({
                title: v === "0" ? "Busy mode off" : `Busy mode on, +${v} min`,
                tone: "success",
              }),
          })
        }
        options={[
          { value: "0", label: "Off", detail: "Prep times as you set them" },
          { value: "10", label: "+10 min", detail: "A rush on" },
          { value: "20", label: "+20 min", detail: "Kitchen is flat out" },
        ]}
      />
    </Panel>
  );
}

// ---------- Weekly hours ----------

function WeeklyHours({ hours }: { hours: DayHours[] }) {
  const toast = useToast();
  const save = useSaveHours();
  const [draft, setDraft] = useState(hours);
  const [submitted, setSubmitted] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(hours);

  const update = (day: Weekday, change: (d: DayHours) => DayHours) =>
    setDraft((ds) => ds.map((d) => (d.day === day ? change(d) : d)));
  const invalid = (d: DayHours) =>
    d.isOpen && d.ranges.some((r) => !r.open || !r.close || r.open === r.close);

  return (
    <Panel
      title="Opening hours"
      titleId="hours-title"
      className={styles.panel}
      action={dirty ? <span className={styles.unsaved}>Unsaved changes</span> : undefined}
    >
      <p className={styles.muted}>
        Closing after midnight is fine: set 11:00 pm to 2:00 am and we read it as the next morning.
      </p>
      <form
        className={styles.week}
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (draft.some(invalid)) return;
          save.mutate(draft, {
            onSuccess: () =>
              toast({
                title: "Hours saved",
                description: "Customers see the new times now.",
                tone: "success",
              }),
          });
        }}
      >
        {draft.map((d) => (
          <fieldset key={d.day} className={styles.day}>
            <legend className="kd-visually-hidden">{dayNames[d.day]}</legend>
            <Switch
              size="lg"
              className={styles.dayToggle}
              label={dayNames[d.day]}
              description={d.isOpen ? "Open" : "Closed all day"}
              checked={d.isOpen}
              onChange={(isOpen) =>
                update(d.day, (x) => ({
                  ...x,
                  isOpen,
                  ranges: x.ranges.length ? x.ranges : [{ open: "11:00", close: "22:00" }],
                }))
              }
            />
            {d.isOpen && (
              <div className={styles.ranges}>
                {d.ranges.map((r, i) => (
                  <div key={i} className={styles.range}>
                    <TextField
                      type="time"
                      label={`${dayNames[d.day]} opens`}
                      hideLabel
                      value={r.open}
                      onChange={(e) =>
                        update(d.day, (x) => ({
                          ...x,
                          ranges: x.ranges.map((y, j) => (j === i ? { ...y, open: e.target.value } : y)),
                        }))
                      }
                      className={styles.time}
                    />
                    <span aria-hidden="true">to</span>
                    <TextField
                      type="time"
                      label={`${dayNames[d.day]} closes`}
                      hideLabel
                      value={r.close}
                      onChange={(e) =>
                        update(d.day, (x) => ({
                          ...x,
                          ranges: x.ranges.map((y, j) => (j === i ? { ...y, close: e.target.value } : y)),
                        }))
                      }
                      className={styles.time}
                    />
                    {i > 0 && (
                      <IconButton
                        icon="close"
                        variant="soft"
                        label={`Remove ${dayNames[d.day]}'s second opening`}
                        onClick={() => update(d.day, (x) => ({ ...x, ranges: x.ranges.slice(0, 1) }))}
                      />
                    )}
                  </div>
                ))}
                {d.ranges.length < 2 && (
                  <Button
                    variant="outline"
                    icon="plus"
                    onClick={() =>
                      update(d.day, (x) => ({
                        ...x,
                        ranges: [...x.ranges, { open: "18:00", close: "23:00" }],
                      }))
                    }
                  >
                    Add a second opening
                  </Button>
                )}
                {submitted && invalid(d) && (
                  <p className={styles.error} role="alert">
                    Set different opening and closing times for {dayNames[d.day]}.
                  </p>
                )}
              </div>
            )}
          </fieldset>
        ))}
        <div className={styles.formActions}>
          <Button type="submit" size="lg" disabled={!dirty || save.isPending}>
            Save hours
          </Button>
          {dirty && (
            <Button variant="secondary" size="lg" onClick={() => setDraft(hours)}>
              Discard changes
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}

// ---------- Special closures ----------

const closureReasons = ["Poya day", "Public holiday", "Staff holiday", "Repairs", "Other"];

function Closures({ closures }: { closures: Closure[] }) {
  const toast = useToast();
  const add = useAddClosure();
  const remove = useRemoveClosure();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState(closureReasons[0]!);
  const [other, setOther] = useState("");
  const [error, setError] = useState("");
  const today = todayIso();
  const upcoming = closures.filter((c) => c.date >= today);

  return (
    <Panel title="Special closures" titleId="closures-title" className={styles.panel}>
      <p className={styles.muted}>
        Days you're closed outside your usual hours. Customers see them a week ahead.
      </p>
      {upcoming.length ? (
        <ul className={styles.closures}>
          {upcoming.map((c) => (
            <li key={c.id}>
              <span className={styles.closureDate}>{shortDate(c.date)}</span>
              <span>{c.reason}</span>
              <IconButton
                icon="trash"
                variant="soft"
                label={`Remove closure on ${shortDate(c.date)}`}
                onClick={() =>
                  remove.mutate(c.id, {
                    onSuccess: () =>
                      toast({
                        title: "Closure removed",
                        description: `Open as usual on ${shortDate(c.date)}.`,
                      }),
                  })
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No closures coming up. Add Poya days and holidays you'll be shut.</p>
      )}

      <form
        className={styles.addClosure}
        onSubmit={(e) => {
          e.preventDefault();
          const why = reason === "Other" ? other.trim() : reason;
          if (!date) return setError("Choose the date you'll be closed.");
          if (date < today) return setError("Choose today or a later date.");
          if (!why) return setError("Say why you're closed, for example Family wedding.");
          if (closures.some((c) => c.date === date))
            return setError(`You're already closed on ${shortDate(date)}.`);
          setError("");
          add.mutate(
            { date, reason: why },
            {
              onSuccess: () => {
                toast({
                  title: "Closure added",
                  description: `Closed on ${shortDate(date)}.`,
                  tone: "success",
                });
                setDate("");
                setOther("");
              },
            },
          );
        }}
      >
        <TextField
          type="date"
          label="Date"
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Select
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          options={closureReasons.map((r) => ({ value: r, label: r }))}
        />
        {reason === "Other" && (
          <TextField
            label="What's the reason?"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            maxLength={40}
          />
        )}
        <Button type="submit" size="lg" icon="plus" disabled={add.isPending} className={styles.addButton}>
          Add closure
        </Button>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Panel>
  );
}
