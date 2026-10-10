import { Button, Icon, Select } from "@kade/ui";
import { useState } from "react";
import type { ReviewDoc } from "@/api/types";
import { daysUntil, formatDate } from "@/lib/format";
import { Status } from "./Status";
import styles from "./DocReview.module.css";

/** Expiry line for a document: chilli once expired, a plain warning inside 30 days. */
export function ExpiryNote({ iso }: { iso?: string }) {
  if (!iso) return null;
  const days = daysUntil(iso);
  if (days < 0) return <Status tone="alert">Expired {formatDate(iso)}</Status>;
  if (days <= 30)
    return (
      <span className={styles.expiring}>
        <Icon name="clock" size={14} />
        Expires {formatDate(iso)}, in {days === 1 ? "1 day" : `${days} days`}
      </span>
    );
  return <span className={styles.valid}>Valid until {formatDate(iso)}</span>;
}

export function DocStatus({ doc }: { doc: ReviewDoc }) {
  if (doc.status === "approved") return <Status tone="live">Approved</Status>;
  if (doc.status === "rejected") return <Status tone="alert">Rejected</Status>;
  return <Status tone="progress">To review</Status>;
}

export interface DocReviewProps {
  docs: ReviewDoc[];
  /** Specific reasons the applicant sees, so they know exactly what to fix. */
  rejectReasons: string[];
  onDecide?: (docId: string, status: "approved" | "rejected", reason?: string) => void;
  pending?: boolean;
}

/** Document checklist with an inline viewer. Each document is approved or rejected on its own. */
export function DocReview({ docs, rejectReasons, onDecide, pending }: DocReviewProps) {
  const [openId, setOpenId] = useState<string | null>(docs.find((d) => d.status === "pending")?.id ?? null);
  const [reason, setReason] = useState("");

  return (
    <ul className={styles.list}>
      {docs.map((d) => {
        const open = openId === d.id;
        const panelId = `doc-panel-${d.id}`;
        return (
          <li key={d.id} className={styles.item}>
            <button
              type="button"
              className={styles.head}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => {
                setOpenId(open ? null : d.id);
                setReason("");
              }}
            >
              <Icon name="doc" size={18} />
              <span className={styles.kind}>
                {d.kind}
                <span className={styles.file}>{d.fileName}</span>
              </span>
              <DocStatus doc={d} />
              <Icon name={open ? "chevronDown" : "chevronRight"} size={16} />
            </button>
            {open && (
              <div id={panelId} className={styles.panel}>
                {/* Stand-in for the uploaded scan: the fields our OCR read from it */}
                <figure className={styles.paper} aria-label={`${d.kind} preview`}>
                  <figcaption className={styles.paperTitle}>{d.kind}</figcaption>
                  <dl>
                    {d.fields.map((f) => (
                      <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </figure>
                <ExpiryNote iso={d.expiresOn} />
                {d.status === "rejected" && d.rejectReason && (
                  <p className={styles.reason}>Rejected: {d.rejectReason}</p>
                )}
                {onDecide && (
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      icon="check"
                      disabled={pending || d.status === "approved"}
                      onClick={() => {
                        onDecide(d.id, "approved");
                        const next = docs.find((x) => x.id !== d.id && x.status === "pending");
                        setOpenId(next?.id ?? null);
                      }}
                    >
                      {d.status === "approved" ? "Approved" : "Approve"}
                    </Button>
                    <div className={styles.reject}>
                      <Select
                        label={`Reason for rejecting ${d.kind.toLowerCase()}`}
                        hideLabel
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        options={[
                          { value: "", label: "Reject with reason…" },
                          ...rejectReasons.map((r) => ({ value: r, label: r })),
                        ]}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || !reason}
                        onClick={() => onDecide(d.id, "rejected", reason)}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
