import { Button, Choice, Icon, Tag, cx, formatRs, plural, useToast } from "@kade/ui";
import { useId } from "react";
import { Navigate, useNavigate } from "react-router";
import { useArriveAtRestaurant, useConfirmPickup, useReportNotReady } from "@/api/queries";
import { nextTurn } from "@/features/job/directions";
import { useJobStep } from "@/features/job/guard";
import { PICKUP_LEG_SECONDS, legProgress, minutesLeft } from "@/features/job/legs";
import { useJob, type ActiveJob } from "@/features/job/store";
import { RiderMap } from "@/features/map/RiderMap";
import { Hud, MapScreen } from "@/layout/MapScreen";
import c from "@/layout/common.module.css";
import { clockTime } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./JobPages.module.css";

export function PickupPage() {
  const { job, redirect } = useJobStep("pickup");
  useDocumentTitle("Pickup");
  if (!job) return <Navigate to={redirect ?? "/"} replace />;
  return job.arrivedAtRestaurantAt ? <OrderCheck job={job} /> : <RideToRestaurant job={job} />;
}

function RideToRestaurant({ job }: { job: ActiveJob }) {
  const now = useNow(1000);
  const arrive = useArriveAtRestaurant();
  const p = legProgress(job.acceptedAt, PICKUP_LEG_SECONDS, now);
  // Share of the whole job's minutes spent reaching the restaurant
  const legMinutes = Math.round((job.minutes * job.toPickupKm) / (job.toPickupKm + job.tripKm));
  const mins = minutesLeft(legMinutes, p);
  const turn = nextTurn(p, job.restaurant.point, job.restaurant.name, job.toPickupKm * (1 - p), mins);

  return (
    <MapScreen
      label="Pickup"
      map={
        <RiderMap
          mode="route"
          from={job.from}
          to={job.restaurant.point}
          progress={p}
          destination="store"
          label={`Route to ${job.restaurant.name}. ${Math.round(p * 100)}% of the way, about ${mins} minutes left.`}
        />
      }
      overlay={<Hud title={turn.title} detail={turn.detail} />}
    >
      <div>
        <p className={c.figureLabel}>Pick up from</p>
        <h1 className={c.heading}>{job.restaurant.name}</h1>
        <p className={c.lead}>{job.restaurant.address}</p>
      </div>
      <div className={c.row}>
        <Button
          variant="secondary"
          size="lg"
          icon="phone"
          href={`tel:${job.restaurant.phone.replace(/\s/g, "")}`}
        >
          Call restaurant
        </Button>
        <Tag
          className={c.fixed}
          tone={job.payment === "cash" ? "warning" : "neutral"}
          size="md"
          icon={job.payment === "cash" ? "cash" : "card"}
        >
          {job.payment === "cash" ? `Cash ${formatRs(job.cashToCollect)}` : "Card"}
        </Tag>
      </div>
      <Button
        size="lg"
        fullWidth
        className={c.action}
        disabled={arrive.isPending}
        onClick={() => arrive.mutate(job.id, { onSuccess: (at) => useJob.getState().arriveRestaurant(at) })}
      >
        I've arrived
      </Button>
    </MapScreen>
  );
}

function OrderCheck({ job }: { job: ActiveJob }) {
  const now = useNow(1000, !!job.readyAt);
  const navigate = useNavigate();
  const toast = useToast();
  const notReady = useReportNotReady();
  const confirm = useConfirmPickup();
  const { toggleItem, setSealed, setReadyAt } = useJob.getState();
  const hintId = useId();

  const units = job.items.reduce((s, i) => s + i.qty, 0);
  const allChecked = job.items.every((i) => job.checked.includes(i.id));
  const canPickUp = allChecked || job.sealedConfirmed;
  const waiting = job.readyAt && job.readyAt > now ? Math.ceil((job.readyAt - now) / 60_000) : 0;

  const onPickedUp = () =>
    confirm.mutate(
      { jobId: job.id, checkedItems: job.checked, sealed: job.sealedConfirmed, totalItems: job.items.length },
      {
        onSuccess: (at) => {
          useJob.getState().pickedUp(at);
          toast({
            title: "Order picked up",
            description: `Take it to ${job.customer.firstName}.`,
            tone: "success",
          });
          navigate("/job/dropoff");
        },
        onError: (e) => toast({ title: "Couldn't confirm pickup", description: e.message, tone: "error" }),
      },
    );

  return (
    <>
      <div className={c.page}>
        <div>
          <p className={c.figureLabel}>At {job.restaurant.name}. Show the counter this number</p>
          <h1 className={styles.orderNumber}>{job.orderNumber}</h1>
          <p className={c.lead}>
            For {job.customer.firstName}, {plural(units, "item")}
          </p>
        </div>

        {job.foodReadyAt ? (
          <div className={styles.waitBox} role="status">
            <Icon name="check" size={24} />
            <div>
              <p className={c.subheading}>Order ready</p>
              <p>The kitchen marked it ready at {clockTime(job.foodReadyAt)}. Collect it at the counter.</p>
            </div>
          </div>
        ) : job.readyAt ? (
          <div className={styles.waitBox} role="status">
            <Icon name="timer" size={24} />
            <div>
              {waiting > 0 ? (
                <>
                  <p className={c.subheading}>Ready in about {plural(waiting, "minute")}</p>
                  <p>
                    The kitchen expects it at {clockTime(job.readyAt)}. Waiting after the first 10 minutes is
                    paid.
                  </p>
                </>
              ) : (
                <p className={c.subheading}>It should be ready now. Ask at the counter.</p>
              )}
              <Button
                variant="outline"
                size="sm"
                className={styles.waitDone}
                onClick={() => setReadyAt(undefined)}
              >
                It's ready
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            icon="timer"
            disabled={notReady.isPending}
            onClick={() => notReady.mutate(job, { onSuccess: ({ readyAt }) => setReadyAt(readyAt) })}
          >
            Order not ready yet
          </Button>
        )}

        <section className={c.section} aria-labelledby="items-title">
          <h2 id="items-title" className={c.sectionTitle}>
            Check the bag
          </h2>
          {job.sealed && (
            <p className={styles.sealedNote}>
              <Icon name="lock" size={18} /> The kitchen seals this order. Check the receipt on the bag
              matches {job.orderNumber}.
            </p>
          )}
          <ul className={styles.checklist}>
            {job.items.map((item) => (
              <li key={item.id}>
                <Choice
                  type="checkbox"
                  className={styles.checkItem}
                  checked={job.checked.includes(item.id)}
                  onChange={() => toggleItem(item.id)}
                  disabled={job.sealedConfirmed}
                  label={
                    <span className={styles.itemText}>
                      <strong>
                        {item.qty} × {item.name}
                      </strong>
                      {item.options && <span>{item.options}</span>}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
          <Choice
            type="checkbox"
            className={cx(styles.checkItem, styles.sealedChoice)}
            checked={job.sealedConfirmed}
            onChange={(e) => setSealed(e.target.checked)}
            label={
              <span className={styles.itemText}>
                <strong>Items are sealed</strong>
                <span>The bag is sealed, so I can't check each item</span>
              </span>
            }
          />
        </section>
      </div>

      <div className={c.sticky}>
        {!canPickUp && (
          <p id={hintId} className={c.hint}>
            Tick {plural(job.items.length - job.checked.length, "more item")}, or confirm the bag is sealed
          </p>
        )}
        <Button
          size="lg"
          fullWidth
          className={c.action}
          disabled={!canPickUp || confirm.isPending}
          aria-describedby={canPickUp ? undefined : hintId}
          onClick={onPickedUp}
        >
          Picked up order
        </Button>
      </div>
    </>
  );
}
