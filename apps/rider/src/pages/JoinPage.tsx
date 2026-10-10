import { Button, Icon, Select, Tag, TextField, cx, useToast } from "@kade/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { clearApplication, type ApplicationStatus } from "@/api/onboarding";
import { keys, useApplicationStatus, useResubmitDocument, useSubmitApplication } from "@/api/queries";
import { BANKS, CITIES, LESSONS, VEHICLES, docsFor, useJoin } from "@/features/join/store";
import { PhoneFrame } from "@/layout/PhoneFrame";
import c from "@/layout/common.module.css";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./JoinPage.module.css";

const STEPS = ["Your details", "Vehicle", "Documents", "Bank account", "Training"] as const;

const NIC = /^(\d{9}[VvXx]|\d{12})$/;
const MOBILE = /^(\+94|0)?7\d{8}$/;

export function JoinPage() {
  useDocumentTitle("Ride with Kadé");
  const status = useApplicationStatus();

  return (
    <PhoneFrame>
      <header className={styles.top}>
        <span className={styles.brand}>
          <span className={styles.wordmark}>kadé</span>
          <span className={styles.product}>Rider</span>
        </span>
      </header>
      <main id="main" className={styles.main}>
        {status.isPending ? (
          <p className={c.page}>Loading…</p>
        ) : status.data && status.data.state !== "none" ? (
          <StatusScreen status={status.data} />
        ) : (
          <Wizard />
        )}
      </main>
    </PhoneFrame>
  );
}

// ---------- Wizard ----------

function Wizard() {
  const form = useJoin();
  const { step, setStep } = form;
  const [showErrors, setShowErrors] = useState(false);
  const submit = useSubmitApplication();
  const toast = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // Move focus to the new step's heading so screen readers hear where they are
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const errors = validate(step, form);
  const valid = Object.keys(errors).length === 0;
  const last = step === STEPS.length - 1;

  const next = () => {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (!last) {
      setStep(step + 1);
      return;
    }
    submit.mutate(
      {
        name: form.name,
        nic: form.nic,
        phone: form.phone,
        city: form.city,
        vehicle: form.vehicle!,
        documents: form.documents,
        bank: form.bank,
        lessons: form.lessons,
      },
      {
        onSuccess: () => toast({ title: "Application sent", tone: "success" }),
        onError: (e) =>
          toast({ title: "Couldn't send your application", description: e.message, tone: "error" }),
      },
    );
  };

  const shown = showErrors ? errors : {};

  return (
    <>
      <div className={c.page}>
        {step === 0 && (
          <div className={styles.intro}>
            <p className={styles.introTitle}>Ride with Kadé</p>
            <p className={c.lead}>
              Pick your own hours, get paid every Tuesday, and keep 100% of your tips. Takes about 10 minutes.
            </p>
          </div>
        )}

        <ol className={styles.steps} aria-label="Application steps">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={cx(styles.step, i < step && styles.stepDone, i === step && styles.stepNow)}
              aria-current={i === step ? "step" : undefined}
            >
              <span className={styles.stepNum}>{i < step ? <Icon name="check" size={14} /> : i + 1}</span>
              <span className={i === step ? undefined : "kd-visually-hidden"}>
                {s}
                {i < step ? ", done" : ""}
              </span>
            </li>
          ))}
        </ol>

        <h1 ref={headingRef} tabIndex={-1} className={c.heading}>
          {STEPS[step]}
        </h1>

        {step === 0 && <Details errors={shown} />}
        {step === 1 && <VehicleStep error={shown.vehicle} />}
        {step === 2 && <DocumentsStep error={shown.documents} />}
        {step === 3 && <BankStep errors={shown} />}
        {step === 4 && <TrainingStep error={shown.lessons} />}
      </div>

      <div className={c.sticky}>
        <div className={c.row}>
          {step > 0 && (
            <Button variant="secondary" size="lg" className={c.fixed} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button size="lg" fullWidth className={c.action} onClick={next} disabled={submit.isPending}>
            {last ? (submit.isPending ? "Sending…" : "Send application") : "Continue"}
          </Button>
        </div>
        <p className={c.hint}>
          Step {step + 1} of {STEPS.length}
        </p>
      </div>
    </>
  );
}

type Errors = Partial<Record<string, string>>;

function validate(step: number, f: ReturnType<typeof useJoin.getState>): Errors {
  const e: Errors = {};
  if (step === 0) {
    if (f.name.trim().split(/\s+/).length < 2) e.name = "Enter your full name as it is on your NIC.";
    if (!NIC.test(f.nic.trim())) e.nic = "Enter your NIC number: 9 digits and V or X, or 12 digits.";
    if (!MOBILE.test(f.phone.replace(/[\s-]/g, "")))
      e.phone = "Enter a Sri Lankan mobile number, like 077 123 4567.";
    if (!f.city) e.city = "Choose where you'll ride.";
  }
  if (step === 1 && !f.vehicle) e.vehicle = "Choose how you'll deliver.";
  if (step === 2) {
    const missing = docsFor(f.vehicle).filter((d) => !f.documents[d.key]);
    if (missing.length) e.documents = `Add a photo of your ${missing.map((d) => d.name).join(", ")}.`;
  }
  if (step === 3) {
    if (!f.bank.bank) e.bank = "Choose your bank.";
    if (!f.bank.branch.trim()) e.branch = "Enter your branch, like Kollupitiya.";
    if (!/^\d{8,16}$/.test(f.bank.account.replace(/\s/g, "")))
      e.account = "Enter your account number, 8 to 16 digits.";
    if (f.bank.holder.trim().length < 3) e.holder = "Enter the name on the account.";
  }
  if (step === 4 && f.lessons.length < LESSONS.length)
    e.lessons = "Finish all three lessons to send your application.";
  return e;
}

function Details({ errors }: { errors: Errors }) {
  const { name, nic, phone, city, set } = useJoin();
  return (
    <div className={styles.fields}>
      <TextField
        label="Full name"
        autoComplete="name"
        value={name}
        onChange={(e) => set({ name: e.target.value })}
        error={errors.name}
      />
      <TextField
        label="NIC number"
        value={nic}
        autoCapitalize="characters"
        onChange={(e) => set({ nic: e.target.value.toUpperCase() })}
        hint="Old (9 digits and V) or new (12 digits)"
        error={errors.nic}
      />
      <TextField
        label="Mobile number"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        value={phone}
        onChange={(e) => set({ phone: e.target.value })}
        hint="We'll send your approval here by SMS"
        error={errors.phone}
      />
      <div>
        <Select
          label="Where you'll ride"
          value={city}
          onChange={(e) => set({ city: e.target.value })}
          options={[{ value: "", label: "Choose an area" }, ...CITIES.map((x) => ({ value: x, label: x }))]}
          aria-invalid={errors.city ? true : undefined}
        />
        {errors.city && (
          <p className={c.error} role="alert">
            {errors.city}
          </p>
        )}
      </div>
    </div>
  );
}

function VehicleStep({ error }: { error?: string }) {
  const { vehicle, set } = useJoin();
  const name = useId();
  return (
    <fieldset className={c.fieldset}>
      <legend className="kd-visually-hidden">How you'll deliver</legend>
      <div className={styles.vehicles}>
        {VEHICLES.map((v) => (
          <label key={v.value} className={cx(styles.vehicle, vehicle === v.value && styles.vehicleOn)}>
            <input
              type="radio"
              name={name}
              value={v.value}
              checked={vehicle === v.value}
              onChange={() => set({ vehicle: v.value })}
              className="kd-visually-hidden"
            />
            <Icon name={v.icon} size={28} />
            <span className={styles.vehicleText}>
              <strong>{v.label}</strong>
              <span>{v.note}</span>
              <span className={styles.needs}>You'll need: {v.needs}</span>
            </span>
            <span className={styles.radioMark} aria-hidden="true" />
          </label>
        ))}
      </div>
      {error && (
        <p className={c.error} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function UploadRow({
  name,
  hint,
  fileName,
  onFile,
  status,
}: {
  name: string;
  hint: string;
  fileName?: string;
  onFile: (fileName: string) => void;
  status?: ReactNode;
}) {
  const id = useId();
  return (
    <li className={cx(styles.upload, fileName && styles.uploadDone)}>
      <span className={styles.uploadText}>
        <strong>{name}</strong>
        <span className={c.muted}>{fileName ? fileName : hint}</span>
      </span>
      {status ??
        (fileName ? (
          <Tag tone="positive" icon="check">
            Added
          </Tag>
        ) : null)}
      <label htmlFor={id} className={styles.uploadButton}>
        <Icon name={fileName ? "refresh" : "upload"} size={18} />
        {fileName ? "Retake" : "Add photo"}
        <span className="kd-visually-hidden"> of {name}</span>
      </label>
      <input
        id={id}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="kd-visually-hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f.name);
        }}
      />
    </li>
  );
}

function DocumentsStep({ error }: { error?: string }) {
  const { vehicle, documents, set } = useJoin();
  const docs = docsFor(vehicle);
  return (
    <div className={styles.fields}>
      <p className={c.lead}>
        {vehicle === "bicycle"
          ? "Bicycle riders only need their NIC."
          : "Clear photos, in daylight, with all four corners showing."}
      </p>
      <ul className={styles.uploads}>
        {docs.map((d) => (
          <UploadRow
            key={d.key}
            name={d.name}
            hint={d.hint}
            fileName={documents[d.key]}
            onFile={(fileName) => set({ documents: { ...documents, [d.key]: fileName } })}
          />
        ))}
      </ul>
      {error && (
        <p className={c.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function BankStep({ errors }: { errors: Errors }) {
  const { bank, set } = useJoin();
  const patch = (p: Partial<typeof bank>) => set({ bank: { ...bank, ...p } });
  return (
    <div className={styles.fields}>
      <p className={c.lead}>Your weekly pay goes here. The account must be in your name.</p>
      <div>
        <Select
          label="Bank"
          value={bank.bank}
          onChange={(e) => patch({ bank: e.target.value })}
          options={[{ value: "", label: "Choose your bank" }, ...BANKS.map((b) => ({ value: b, label: b }))]}
          aria-invalid={errors.bank ? true : undefined}
        />
        {errors.bank && (
          <p className={c.error} role="alert">
            {errors.bank}
          </p>
        )}
      </div>
      <TextField
        label="Branch"
        value={bank.branch}
        onChange={(e) => patch({ branch: e.target.value })}
        error={errors.branch}
      />
      <TextField
        label="Account number"
        inputMode="numeric"
        value={bank.account}
        onChange={(e) => patch({ account: e.target.value.replace(/[^\d\s]/g, "") })}
        error={errors.account}
      />
      <TextField
        label="Name on the account"
        value={bank.holder}
        onChange={(e) => patch({ holder: e.target.value })}
        error={errors.holder}
      />
    </div>
  );
}

function TrainingStep({ error }: { error?: string }) {
  const { lessons, set } = useJoin();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className={styles.fields}>
      <p className={c.lead}>Three short lessons, about 10 minutes in all.</p>
      <ol className={styles.lessons}>
        {LESSONS.map((l, i) => {
          const done = lessons.includes(l.id);
          const open = openId === l.id;
          return (
            <li key={l.id} className={cx(styles.lesson, done && styles.lessonDone)}>
              <button
                type="button"
                className={styles.lessonHead}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : l.id)}
              >
                <span className={styles.stepNum}>{done ? <Icon name="check" size={14} /> : i + 1}</span>
                <span className={styles.lessonTitle}>
                  <strong>{l.title}</strong>
                  <span className={c.muted}>{l.minutes} min</span>
                </span>
                {done ? (
                  <Tag tone="positive">Done</Tag>
                ) : (
                  <Icon name={open ? "chevronDown" : "chevronRight"} size={18} />
                )}
              </button>
              {open && (
                <div className={styles.lessonBody}>
                  <ul>
                    {l.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  {!done && (
                    <Button
                      onClick={() => {
                        set({ lessons: [...lessons, l.id] });
                        setOpenId(LESSONS.find((x) => x.id !== l.id && !lessons.includes(x.id))?.id ?? null);
                      }}
                    >
                      Mark as done
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error && (
        <p className={c.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------- Application status ----------

function StatusScreen({ status }: { status: Exclude<ApplicationStatus, { state: "none" }> }) {
  const resubmit = useResubmitDocument();
  const reset = useJoin((s) => s.reset);
  const toast = useToast();
  const [fixFile, setFixFile] = useState<string>();
  const qc = useQueryClient();

  const startOver = () => {
    clearApplication();
    reset();
    qc.setQueryData<ApplicationStatus>(keys.application, { state: "none" });
  };

  const stages = [
    { label: "Application sent", done: true },
    { label: "Documents checked", done: status.state === "approved" },
    { label: "Approved", done: status.state === "approved" },
  ];

  return (
    <div className={c.page}>
      {status.state === "inReview" && (
        <div className={styles.statusHead} role="status">
          <Tag tone="warning" icon="timer" size="md">
            In review
          </Tag>
          <h1 className={c.heading}>We're checking your documents</h1>
          <p className={c.lead}>Usually within 2 working days. We'll send you an SMS when it's done.</p>
        </div>
      )}
      {status.state === "needsFix" && (
        <div className={styles.statusHead} role="status">
          <Tag tone="offer" icon="alert" size="md">
            Needs a fix
          </Tag>
          <h1 className={c.heading}>One document needs a new photo</h1>
          <div className={cx(c.danger, styles.fixBox)}>
            <strong>{status.docName}</strong>
            <p>{status.reason}</p>
          </div>
          <ul className={styles.uploads}>
            <UploadRow
              name={status.docName}
              hint="Take it again in daylight"
              fileName={fixFile}
              onFile={setFixFile}
            />
          </ul>
          <Button
            size="lg"
            fullWidth
            className={c.action}
            disabled={!fixFile || resubmit.isPending}
            onClick={() =>
              resubmit.mutate(
                { doc: status.doc, fileName: fixFile! },
                { onSuccess: () => toast({ title: "New photo sent", tone: "success" }) },
              )
            }
          >
            Send new photo
          </Button>
        </div>
      )}
      {status.state === "approved" && (
        <div className={styles.statusHead} role="status">
          <Tag tone="live" icon="check" size="md">
            Approved
          </Tag>
          <h1 className={c.heading}>You're approved{status.firstName ? `, ${status.firstName}` : ""}.</h1>
          <p className={c.lead}>
            Collect your Kadé bag and rain jacket at the rider hub, 12 Station Rd, Kollupitiya. Any day, 8 am
            to 6 pm. Bring your NIC.
          </p>
          <Button href="/" size="lg" fullWidth className={c.action}>
            Start riding
          </Button>
        </div>
      )}

      <ol className={styles.stages} aria-label="Application progress">
        {stages.map((s, i) => (
          <li key={s.label} className={cx(styles.stage, s.done && styles.stageDone)}>
            <span className={styles.stepNum}>{s.done ? <Icon name="check" size={14} /> : i + 1}</span>
            {s.label}
            <span className="kd-visually-hidden">{s.done ? ", done" : ", not yet"}</span>
          </li>
        ))}
      </ol>
      <p className={c.muted}>Application {status.id}</p>
      <button type="button" className={styles.startOver} onClick={startOver}>
        Start a new application
      </button>
    </div>
  );
}
