import { Button, Chip, Icon, Sheet, Tabs, TextField, cx, formatRs, useToast } from "@kade/ui";
import { useId, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useArriveAtCustomer, useCompleteDelivery, useMessageCustomer } from "@/api/queries";
import { nextTurn } from "@/features/job/directions";
import { useJobStep } from "@/features/job/guard";
import { DROPOFF_LEG_SECONDS, legProgress, minutesLeft } from "@/features/job/legs";
import { useJob, type ActiveJob } from "@/features/job/store";
import { RiderMap } from "@/features/map/RiderMap";
import { Hud, MapScreen } from "@/layout/MapScreen";
import c from "@/layout/common.module.css";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./JobPages.module.css";

export function DropoffPage() {
  const { job, redirect } = useJobStep("dropoff");
  useDocumentTitle("Drop-off");
  if (!job) return <Navigate to={redirect ?? "/"} replace />;
  return job.arrivedAtCustomerAt ? <AtTheDoor job={job} /> : <RideToCustomer job={job} />;
}

const tel = (n: string) => `tel:${n.replace(/\s/g, "")}`;

function RideToCustomer({ job }: { job: ActiveJob }) {
  const now = useNow(1000);
  const arrive = useArriveAtCustomer();
  const [messaging, setMessaging] = useState(false);
  const start = job.pickedUpAt ?? job.acceptedAt;
  const p = legProgress(start, DROPOFF_LEG_SECONDS, now);
  const legMinutes = Math.round((job.minutes * job.tripKm) / (job.toPickupKm + job.tripKm));
  const mins = minutesLeft(legMinutes, p);
  const turn = nextTurn(p, job.customer.point, job.customer.firstName, job.tripKm * (1 - p), mins);

  return (
    <MapScreen
      label="Drop-off"
      map={
        <RiderMap
          mode="route"
          from={job.restaurant.point}
          to={job.customer.point}
          progress={p}
          destination="home"
          label={`Route to ${job.customer.firstName} in ${job.customer.area}. ${Math.round(p * 100)}% of the way, about ${mins} minutes left.`}
        />
      }
      overlay={<Hud title={turn.title} detail={turn.detail} />}
    >
      <div>
        <p className={c.figureLabel}>Deliver to</p>
        <h1 className={c.heading}>{job.customer.firstName}</h1>
        <p className={c.lead}>{job.customer.address}</p>
      </div>
      {job.customer.note && (
        <blockquote className={styles.note}>
          <Icon name="chat" size={18} />
          <p>
            <span className="kd-visually-hidden">Note from {job.customer.firstName}: </span>
            {job.customer.note}
          </p>
        </blockquote>
      )}
      {job.payment === "cash" && (
        <p className={styles.cashLine}>
          <Icon name="cash" size={20} /> Collect {formatRs(job.cashToCollect)} in cash
        </p>
      )}
      <div className={c.row}>
        <Button variant="secondary" size="lg" icon="phone" href={tel(job.customer.maskedPhone)}>
          Call
        </Button>
        <Button variant="secondary" size="lg" icon="chat" onClick={() => setMessaging(true)}>
          Message
        </Button>
      </div>
      <Button
        size="lg"
        fullWidth
        className={c.action}
        disabled={arrive.isPending}
        onClick={() => arrive.mutate(job.id, { onSuccess: (at) => useJob.getState().arriveCustomer(at) })}
      >
        I've arrived
      </Button>
      <QuickReplies job={job} open={messaging} onOpenChange={setMessaging} />
    </MapScreen>
  );
}

const QUICK_REPLIES = [
  "I'm on the way with your order",
  "I'm outside your gate",
  "Running about 5 minutes late, sorry",
  "I can't find the address. Can you guide me?",
];

function QuickReplies({
  job,
  open,
  onOpenChange,
}: {
  job: ActiveJob;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const send = useMessageCustomer();
  const toast = useToast();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Message ${job.customer.firstName}`}>
      <p className={c.muted}>Messages go through Kadé. Neither of you sees the other's number.</p>
      <ul className={styles.replies}>
        {QUICK_REPLIES.map((text) => (
          <li key={text}>
            <button
              type="button"
              className={styles.reply}
              disabled={send.isPending}
              onClick={() =>
                send.mutate(
                  { jobId: job.id, text },
                  {
                    onSuccess: () => {
                      onOpenChange(false);
                      toast({ title: "Message sent", description: text, tone: "success" });
                    },
                  },
                )
              }
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

type ProofKind = "code" | "photo";

function AtTheDoor({ job }: { job: ActiveJob }) {
  const navigate = useNavigate();
  const complete = useCompleteDelivery();
  const [proofKind, setProofKind] = useState<ProofKind>("code");
  const [code, setCode] = useState("");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [collected, setCollected] = useState(false);
  const [error, setError] = useState<string>();
  const hintId = useId();
  const isCash = job.payment === "cash";

  const proofReady = proofKind === "code" ? code.length === 4 : !!photo;
  const ready = proofReady && (!isCash || collected);
  const missing = !proofReady
    ? proofKind === "code"
      ? "Enter the 4-digit code"
      : "Take a photo at the door"
    : isCash && !collected
      ? `Collect ${formatRs(job.cashToCollect)} first`
      : "";

  const onDelivered = () => {
    setError(undefined);
    complete.mutate(
      {
        job,
        proof: proofKind === "code" ? { kind: "code" } : { kind: "photo", fileName: photo!.file.name },
        code,
        cashCollected: isCash && collected ? job.cashToCollect : 0,
      },
      {
        onSuccess: (trip) => {
          useJob.getState().delivered(trip);
          navigate("/job/done");
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <>
      <div className={c.page}>
        <div>
          <p className={c.figureLabel}>At the door</p>
          <h1 className={c.heading}>Hand over to {job.customer.firstName}</h1>
          <p className={c.lead}>{job.customer.address}</p>
        </div>

        {isCash && <CashCollect job={job} collected={collected} onCollected={setCollected} />}

        <section className={c.section} aria-labelledby="proof-title">
          <h2 id="proof-title" className={c.sectionTitle}>
            Proof of delivery
          </h2>
          <Tabs<ProofKind>
            label="Proof of delivery"
            value={proofKind}
            onChange={(v) => {
              setProofKind(v);
              setError(undefined);
            }}
            items={[
              { value: "code", label: "Delivery code" },
              { value: "photo", label: "Photo at the door" },
            ]}
          >
            {proofKind === "code" ? (
              <div className={styles.proofBody}>
                <TextField
                  label={`Code from ${job.customer.firstName}'s app`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={code}
                  className={styles.codeField}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
                    setError(undefined);
                  }}
                  error={error}
                  hint={
                    `Ask ${job.customer.firstName} for the 4 digits on the order screen.` +
                    (job.deliveryCode ? ` For this demo it's ${job.deliveryCode}.` : "")
                  }
                />
              </div>
            ) : (
              <PhotoProof photo={photo} onPhoto={setPhoto} />
            )}
          </Tabs>
        </section>
        {error && proofKind === "photo" && (
          <p className={c.error} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className={c.sticky}>
        {!ready && (
          <p id={hintId} className={c.hint}>
            {missing}
          </p>
        )}
        <Button
          size="lg"
          fullWidth
          icon="check"
          className={c.action}
          disabled={!ready || complete.isPending}
          aria-describedby={ready ? undefined : hintId}
          onClick={onDelivered}
        >
          {complete.isPending ? "Finishing…" : "Delivered"}
        </Button>
      </div>
    </>
  );
}

interface Photo {
  file: File;
  url: string;
}

function PhotoProof({ photo, onPhoto }: { photo: Photo | null; onPhoto: (p: Photo | null) => void }) {
  const inputId = useId();
  return (
    <div className={styles.proofBody}>
      {photo ? (
        <figure className={styles.photo}>
          <img src={photo.url} alt="The order at the customer's door" />
          <figcaption>
            <Icon name="check" size={18} /> Photo added
          </figcaption>
        </figure>
      ) : (
        <p className={c.muted}>Show the bag and the door number in one photo.</p>
      )}
      <label htmlFor={inputId} className={styles.cameraButton}>
        <Icon name="image" size={22} />
        {photo ? "Retake photo" : "Take photo"}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="kd-visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (photo) URL.revokeObjectURL(photo.url);
          onPhoto(file ? { file, url: URL.createObjectURL(file) } : null);
        }}
      />
    </div>
  );
}

function CashCollect({
  job,
  collected,
  onCollected,
}: {
  job: ActiveJob;
  collected: boolean;
  onCollected: (v: boolean) => void;
}) {
  const due = job.cashToCollect;
  const [received, setReceived] = useState(job.customerPaysWith ? String(job.customerPaysWith) : "");
  const got = Number(received) || 0;
  const change = got - due;
  const notes = [1000, 2000, 5000].filter((n) => n >= due);

  return (
    <section className={cx(styles.cashBox, collected && styles.cashDone)} aria-labelledby="cash-title">
      <h2 id="cash-title" className={c.figureLabel}>
        Cash to collect
      </h2>
      <p className={styles.cashDue}>{formatRs(due)}</p>
      {job.customerPaysWith && (
        <p className={styles.paysWith}>
          {job.customer.firstName} said they'll pay with a {formatRs(job.customerPaysWith)} note.
        </p>
      )}

      {!collected && (
        <div className={styles.changeCalc}>
          <TextField
            label="Cash you were given"
            prefix="Rs"
            inputMode="numeric"
            value={received}
            onChange={(e) => setReceived(e.target.value.replace(/\D/g, ""))}
          />
          <div className={styles.noteChips} aria-label="Common notes">
            <Chip pressed={got === due} onClick={() => setReceived(String(due))}>
              Exact
            </Chip>
            {notes.map((n) => (
              <Chip key={n} pressed={got === n} onClick={() => setReceived(String(n))}>
                {formatRs(n)}
              </Chip>
            ))}
          </div>
          <p className={styles.change} aria-live="polite">
            {got === 0
              ? "Enter what you were given to work out change."
              : change >= 0
                ? `Give back ${formatRs(change)}`
                : `${formatRs(-change)} short`}
          </p>
        </div>
      )}

      {collected ? (
        <div className={styles.collectedRow}>
          <p className={styles.collectedText}>
            <Icon name="check" size={22} /> Collected {formatRs(due)}
          </p>
          <Button variant="outline" size="sm" onClick={() => onCollected(false)}>
            Undo
          </Button>
        </div>
      ) : (
        <Button
          variant="ink"
          size="lg"
          fullWidth
          icon="cash"
          disabled={got > 0 && change < 0}
          onClick={() => onCollected(true)}
        >
          Collected {formatRs(due)}
        </Button>
      )}
    </section>
  );
}
