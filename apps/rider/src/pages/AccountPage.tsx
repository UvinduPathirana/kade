import { Button, ConfirmDialog, Icon, Rating, Select, Sheet, Tag, useToast, type IconName } from "@kade/ui";
import { useEffect, useId, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useDocuments, useHelpTopics, useProfile } from "@/api/queries";
import { supportPhone } from "@/api/support";
import type { HelpTopic, RiderDocument } from "@/api/types";
import { useJob } from "@/features/job/store";
import { SupportChat } from "@/features/support/SupportChat";
import c from "@/layout/common.module.css";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./AccountPage.module.css";

const VEHICLE: Record<string, string> = { motorbike: "Motorbike", tukTuk: "Tuk-tuk", bicycle: "Bicycle" };
const tel = (n: string) => `tel:${n.replace(/\s/g, "")}`;
const LANG_KEY = "kade.rider.language.v1";

const TOPIC_ICON: Record<string, IconName> = {
  accident: "alert",
  unreachable: "phone",
  delay: "timer",
  payment: "wallet",
};

export function AccountPage() {
  useDocumentTitle("Account");
  const { data: profile } = useProfile();
  const { hash } = useLocation();

  useEffect(() => {
    if (hash === "#support") document.getElementById("support")?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <div className={c.page}>
      {profile && (
        <div className={styles.profile}>
          <span className={styles.avatar} aria-hidden="true">
            {profile.name
              .split(" ")
              .map((p) => p[0])
              .join("")}
          </span>
          <div>
            <h1 className={c.heading}>{profile.name}</h1>
            <p className={styles.profileLine}>
              <Rating value={profile.rating} count={profile.ratingCount.toLocaleString("en-LK")} size="md" />
              <span className={c.muted}>Riding since {profile.memberSince}</span>
            </p>
          </div>
        </div>
      )}

      <Support />
      <Vehicle />
      <Documents />
      <Settings />
    </div>
  );
}

function Support() {
  const { data: topics } = useHelpTopics();
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTopic, setChatTopic] = useState<string>();

  return (
    <section id="support" className={c.section} aria-labelledby="support-title">
      <h2 id="support-title" className={c.sectionTitle}>
        Help
      </h2>

      <div className={styles.emergency}>
        <p className={styles.emergencyTitle}>
          <Icon name="alert" size={22} /> In an emergency
        </p>
        <div className={styles.emergencyActions}>
          <a href="tel:1990" className={styles.emergencyCall}>
            <Icon name="phone" size={20} /> Ambulance 1990
          </a>
          <a href="tel:119" className={styles.emergencyCall}>
            <Icon name="phone" size={20} /> Police 119
          </a>
        </div>
      </div>

      <ul className={c.list}>
        {topics?.map((t) => (
          <li key={t.id}>
            <button type="button" className={styles.topic} onClick={() => setTopic(t)}>
              <Icon name={TOPIC_ICON[t.id] ?? "info"} size={22} />
              <span className={styles.topicText}>
                <strong>{t.title}</strong>
                <span className={c.muted}>{t.summary}</span>
              </span>
              <Icon name="chevronRight" size={18} />
            </button>
          </li>
        ))}
      </ul>

      <div className={c.row}>
        <Button
          size="lg"
          icon="chat"
          onClick={() => {
            setChatTopic(undefined);
            setChatOpen(true);
          }}
        >
          Chat with support
        </Button>
        <Button variant="secondary" size="lg" icon="phone" href={tel(supportPhone)}>
          Call
        </Button>
      </div>

      <Sheet open={!!topic} onOpenChange={(o) => !o && setTopic(null)} title={topic?.title ?? ""}>
        {topic && (
          <div className={styles.topicSheet}>
            <ol className={styles.topicSteps}>
              {topic.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {topic.id === "accident" && (
              <a href="tel:1990" className={styles.emergencyCall}>
                <Icon name="phone" size={20} /> Call 1990 ambulance
              </a>
            )}
            <Button
              size="lg"
              icon="chat"
              fullWidth
              onClick={() => {
                setChatTopic(topic.title);
                setTopic(null);
                setChatOpen(true);
              }}
            >
              Chat with support about this
            </Button>
          </div>
        )}
      </Sheet>
      <SupportChat open={chatOpen} onOpenChange={setChatOpen} topic={chatTopic} />
    </section>
  );
}

function Vehicle() {
  const { data: profile } = useProfile();
  if (!profile) return null;
  return (
    <section className={c.section} aria-labelledby="vehicle-title">
      <h2 id="vehicle-title" className={c.sectionTitle}>
        Vehicle and bank
      </h2>
      <dl className={c.list}>
        <div className={c.listRow}>
          <dt>{VEHICLE[profile.vehicle.type]}</dt>
          <dd className={c.amount}>
            {profile.vehicle.model}, {profile.vehicle.plate}
          </dd>
        </div>
        <div className={c.listRow}>
          <dt>Payouts to</dt>
          <dd className={c.amount}>
            {profile.bank.name}, ending {profile.bank.last4}
          </dd>
        </div>
      </dl>
      <p className={c.muted}>
        To change your vehicle or bank account, chat with support. We check the new documents first.
      </p>
    </section>
  );
}

function daysUntil(date: string, now: number) {
  return Math.ceil((new Date(`${date}T23:59:59`).getTime() - now) / 86_400_000);
}

function DocumentRow({ doc, now }: { doc: RiderDocument; now: number }) {
  const inputId = useId();
  const toast = useToast();
  const [uploaded, setUploaded] = useState(false);
  const days = doc.expiresOn ? daysUntil(doc.expiresOn, now) : null;
  const expiry = doc.expiresOn
    ? new Date(doc.expiresOn).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const needsAction = !uploaded && (doc.status === "expiring" || doc.status === "expired");

  return (
    <li className={styles.doc}>
      <span className={styles.docText}>
        <strong>{doc.name}</strong>
        <span className={c.muted}>
          {expiry ? (days !== null && days < 0 ? `Expired ${expiry}` : `Expires ${expiry}`) : "No expiry"}
        </span>
      </span>
      {uploaded ? (
        <Tag tone="neutral">In review</Tag>
      ) : doc.status === "expired" ? (
        <Tag tone="offer">Expired</Tag>
      ) : doc.status === "expiring" && days !== null ? (
        <Tag tone="warning" icon="alert">
          {days <= 0 ? "Expires today" : `${days} days left`}
        </Tag>
      ) : (
        <Tag tone="positive" icon="check">
          Valid
        </Tag>
      )}
      {needsAction && (
        <>
          <label htmlFor={inputId} className={styles.renew}>
            <Icon name="upload" size={18} /> Upload renewed {doc.name.toLowerCase()}
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="kd-visually-hidden"
            onChange={(e) => {
              if (!e.target.files?.[0]) return;
              setUploaded(true);
              toast({
                title: "Document uploaded",
                description: "We'll check it within a day.",
                tone: "success",
              });
            }}
          />
        </>
      )}
    </li>
  );
}

function Documents() {
  const { data } = useDocuments();
  const now = useNow(3_600_000);
  return (
    <section className={c.section} aria-labelledby="docs-title">
      <h2 id="docs-title" className={c.sectionTitle}>
        Documents
      </h2>
      <ul className={c.list}>
        {data?.map((d) => (
          <DocumentRow key={d.id} doc={d} now={now} />
        ))}
      </ul>
      <p className={c.muted}>Jobs pause on the day a document expires. Upload the renewal before then.</p>
    </section>
  );
}

function Settings() {
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_KEY) ?? "en");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const phase = useJob((s) => s.phase);
  const onJob = phase === "pickup" || phase === "dropoff";
  const navigate = useNavigate();
  const toast = useToast();

  return (
    <section className={c.section} aria-labelledby="settings-title">
      <h2 id="settings-title" className={c.sectionTitle}>
        Settings
      </h2>
      <Select
        label="Language"
        value={lang}
        onChange={(e) => {
          setLang(e.target.value);
          localStorage.setItem(LANG_KEY, e.target.value);
          toast({ title: "Language saved" });
        }}
        options={[
          { value: "en", label: "English" },
          { value: "si", label: "සිංහල (Sinhala)" },
          { value: "ta", label: "தமிழ் (Tamil)" },
        ]}
      />
      {lang !== "en" && (
        <p className={c.muted}>
          Sinhala and Tamil screens are being translated. You'll see English until they're ready.
        </p>
      )}

      <Button
        variant="outline"
        size="lg"
        icon="logout"
        disabled={onJob}
        onClick={() => setConfirmOpen(true)}
        aria-describedby={onJob ? "signout-hint" : undefined}
      >
        Sign out
      </Button>
      {onJob && (
        <p id="signout-hint" className={c.muted}>
          Finish your current job before signing out.
        </p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out?"
        description="You'll go offline and stop getting jobs on this phone."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onConfirm={() => {
          useJob.getState().goOffline();
          navigate("/join");
        }}
      />
    </section>
  );
}
