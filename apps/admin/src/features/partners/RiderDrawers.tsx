import { Button, ConfirmDialog, Drawer, Select, TextArea, cx, formatRs, useToast } from "@kade/ui";
import { useState } from "react";
import {
  useDecideRiderApplication,
  useReviewRiderDoc,
  useSetRiderSuspended,
  useSetRiderZones,
  useZones,
} from "@/api/queries";
import type { Rider, RiderApplication } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { Contact } from "@/components/Contact";
import { DetailList, DrawerSection } from "@/components/DetailList";
import { DocReview, ExpiryNote } from "@/components/DocReview";
import { Status } from "@/components/Status";
import u from "@/components/ui.module.css";
import { formatAgo, formatDate, formatPercent } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import styles from "./Partners.module.css";
import { vehicleLabels, worstDoc } from "./riderHelpers";

export function RiderStatusTag({ r }: { r: Rider }) {
  switch (r.status) {
    case "online":
      return <Status tone="live">Online</Status>;
    case "onJob":
      return <Status tone="live">On a delivery</Status>;
    case "offline":
      return <Status tone="done">Offline</Status>;
    case "suspended":
      return <Status tone="stopped">Suspended</Status>;
  }
}

/* ---------- Zones ---------- */

function ZonesForm({ rider }: { rider: Rider }) {
  const toast = useToast();
  const zones = useZones();
  const mutation = useSetRiderZones();
  const [chosen, setChosen] = useState<string[]>(rider.zoneIds);
  const [error, setError] = useState<string | null>(null);
  const changed = chosen.slice().sort().join() !== rider.zoneIds.slice().sort().join();

  return (
    <form
      className={styles.zoneForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen.length) return setError("Choose at least one zone.");
        setError(null);
        mutation.mutate(
          { id: rider.id, zoneIds: chosen },
          {
            onSuccess: () =>
              toast({
                title: "Zones saved",
                description: `${rider.name} gets jobs in ${chosen.length} ${chosen.length === 1 ? "zone" : "zones"}.`,
                tone: "success",
              }),
            onError: (err) => setError(err.message),
          },
        );
      }}
    >
      <fieldset className={u.fieldset}>
        <legend className="kd-visually-hidden">Zones {rider.name} gets jobs in</legend>
        <div className={u.checkGrid}>
          {(zones.data ?? []).map((z) => (
            <label key={z.id} className={u.check}>
              <input
                type="checkbox"
                checked={chosen.includes(z.id)}
                onChange={(e) =>
                  setChosen(e.target.checked ? [...chosen, z.id] : chosen.filter((x) => x !== z.id))
                }
              />
              <span>
                {z.code}
                {z.code !== z.name && <span className={u.muted}> {z.name}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className={u.alertText} role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" variant="secondary" disabled={!changed || mutation.isPending}>
        Save zones
      </Button>
    </form>
  );
}

/* ---------- Suspend ---------- */

const suspendReasons = [
  "Customer complaints under review",
  "Cash not deposited",
  "Driving licence expired",
  "Insurance expired",
  "Unsafe riding reported",
  "Fraud under investigation",
];

function SuspendSheet({ rider, onClose }: { rider: Rider; onClose: () => void }) {
  const toast = useToast();
  const mutation = useSetRiderSuspended();
  const [reason, setReason] = useState(suspendReasons[0]!);
  const [detail, setDetail] = useState("");
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Suspend ${rider.name}`}
      submitLabel="Suspend rider"
      pending={mutation.isPending}
      validate={() => (detail.trim() ? null : "Add the details. The rider sees this in their app.")}
      confirm={{
        title: `Suspend ${rider.name}?`,
        description: `They're logged out and can't go online until someone reinstates them.${
          rider.status === "onJob"
            ? " Their current delivery stays with them; reassign it from Orders if needed."
            : ""
        }`,
        confirmLabel: "Suspend rider",
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({ id: rider.id, suspended: true, reason: `${reason}: ${detail.trim()}` });
        toast({ title: "Rider suspended", description: rider.name, tone: "success" });
      }}
    >
      <Select
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={suspendReasons.map((x) => ({ value: x, label: x }))}
      />
      <TextArea
        label="Details for the rider"
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={3}
      />
    </ActionSheet>
  );
}

/* ---------- Rider detail ---------- */

export function RiderDrawer({ rider, onClose }: { rider: Rider | undefined; onClose: () => void }) {
  const toast = useToast();
  const reinstate = useSetRiderSuspended();
  const [suspending, setSuspending] = useState(false);
  const [reinstating, setReinstating] = useState(false);
  const over = rider ? rider.cashHeld - rider.cashLimit : 0;
  const worst = rider ? worstDoc(rider.documents) : null;

  return (
    <Drawer
      open={!!rider}
      onOpenChange={(o) => !o && onClose()}
      title={rider?.name ?? "Rider"}
      closeLabel="Close rider"
      footer={
        rider && (
          <div className={styles.footer}>
            {rider.status === "suspended" ? (
              <Button size="sm" onClick={() => setReinstating(true)}>
                Reinstate rider
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setSuspending(true)}>
                Suspend rider
              </Button>
            )}
          </div>
        )
      }
    >
      {rider && (
        <div className={styles.body}>
          <div className={styles.summary}>
            <RiderStatusTag r={rider} />
            <p>
              {rider.statusReason ??
                (over > 0
                  ? `Holding ${formatRs(rider.cashHeld)} in cash, ${formatRs(over)} over the limit. Ask them to deposit before taking more cash orders.`
                  : worst && worst.days < 0
                    ? `${worst.doc.kind} expired ${formatDate(worst.doc.expiresOn!)}. Ask for the renewed document, or suspend until it's uploaded.`
                    : `${vehicleLabels[rider.vehicle]} rider, ${rider.id}. Joined ${formatDate(rider.joinedOn)}.`)}
            </p>
          </div>

          <DrawerSection title="This week">
            <dl className={styles.figures}>
              <div>
                <dt>Rating</dt>
                <dd>★ {rider.rating.toFixed(1)}</dd>
              </div>
              <div>
                <dt>Accepted</dt>
                <dd className={cx(rider.acceptanceRate < 0.8 && u.alertText)}>
                  {formatPercent(rider.acceptanceRate)}
                </dd>
              </div>
              <div>
                <dt>Cash held</dt>
                <dd className={cx(over > 0 && u.alertText)}>{formatRs(rider.cashHeld)}</dd>
              </div>
            </dl>
            <p className={cx(u.small, u.muted)}>
              {rider.tripsWeek} trips. Cash limit {formatRs(rider.cashLimit)}.
            </p>
          </DrawerSection>

          <DrawerSection title="Zones">
            <ZonesForm key={rider.id} rider={rider} />
          </DrawerSection>

          <DrawerSection title="Documents">
            <table className={styles.docs}>
              <caption className="kd-visually-hidden">{rider.name}'s documents and expiry dates</caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Expiry</th>
                </tr>
              </thead>
              <tbody>
                {rider.documents.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">
                      {d.kind}
                      <span className={u.muted}> {d.fields[0]?.value}</span>
                    </th>
                    <td>
                      {d.expiresOn ? (
                        <ExpiryNote iso={d.expiresOn} />
                      ) : (
                        <span className={u.muted}>Doesn't expire</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DrawerSection>

          <DrawerSection title="Contact">
            <Contact name={rider.name} phone={rider.phone} />
          </DrawerSection>

          {suspending && <SuspendSheet rider={rider} onClose={() => setSuspending(false)} />}
          <ConfirmDialog
            open={reinstating}
            onOpenChange={setReinstating}
            title={`Reinstate ${rider.name}?`}
            description="They can go online again straight away. The suspension stays in the audit log."
            confirmLabel="Reinstate rider"
            cancelLabel="Go back"
            onConfirm={() =>
              reinstate.mutate(
                { id: rider.id, suspended: false, reason: "Reinstated after review" },
                {
                  onSuccess: () =>
                    toast({ title: "Rider reinstated", description: rider.name, tone: "success" }),
                },
              )
            }
          />
        </div>
      )}
    </Drawer>
  );
}

/* ---------- Applications ---------- */

const riderDocReasons = [
  "Photo is blurry or cut off",
  "Document has expired",
  "Name doesn't match the NIC",
  "Vehicle number doesn't match the revenue licence",
  "Licence doesn't cover this vehicle class",
  "Wrong document uploaded",
];

function RejectApplicantSheet({ app, onClose }: { app: RiderApplication; onClose: () => void }) {
  const toast = useToast();
  const mutation = useDecideRiderApplication();
  const reasons = [
    "Failed police clearance",
    "Under 18",
    "Vehicle not allowed in Colombo zones",
    "Duplicate account",
  ];
  const [reason, setReason] = useState(reasons[0]!);
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reject ${app.name}`}
      submitLabel="Reject applicant"
      pending={mutation.isPending}
      confirm={{
        title: `Reject ${app.name}?`,
        description: "They get an SMS with your reason and can't reapply with the same NIC for 6 months.",
        confirmLabel: "Reject applicant",
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({ id: app.id, decision: "rejected", note: reason });
        toast({ title: "Applicant rejected", description: app.name, tone: "success" });
      }}
    >
      <Select
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={reasons.map((x) => ({ value: x, label: x }))}
      />
    </ActionSheet>
  );
}

export function RiderApplicationDrawer({
  app,
  onClose,
}: {
  app: RiderApplication | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const now = useNow(60_000);
  const zones = useZones();
  const review = useReviewRiderDoc();
  const decide = useDecideRiderApplication();
  const [rejecting, setRejecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const docs = app?.documents ?? [];
  const allApproved = docs.length > 0 && docs.every((d) => d.status === "approved");
  const rejected = docs.filter((d) => d.status === "rejected");
  const decided = app && app.status !== "pending";

  const askForDocs = () =>
    app &&
    decide.mutate(
      {
        id: app.id,
        decision: "changesRequested",
        note: rejected.map((d) => `${d.kind}: ${d.rejectReason}`).join(". "),
      },
      {
        onSuccess: () =>
          toast({
            title: "New documents requested",
            description: `${app.name} gets an SMS listing what to re-upload.`,
            tone: "success",
          }),
      },
    );

  return (
    <Drawer
      open={!!app}
      onOpenChange={(o) => !o && onClose()}
      title={app?.name ?? "Applicant"}
      closeLabel="Close applicant"
      footer={
        app &&
        !decided && (
          <div className={styles.footer}>
            <Button size="sm" icon="check" disabled={!allApproved} onClick={() => setApproving(true)}>
              Approve rider
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!rejected.length || decide.isPending}
              onClick={askForDocs}
            >
              Ask for new documents
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
              Reject
            </Button>
          </div>
        )
      }
    >
      {app && (
        <div className={styles.body}>
          <div className={styles.summary}>
            {decided ? (
              <Status
                tone={app.status === "approved" ? "live" : app.status === "rejected" ? "stopped" : "progress"}
              >
                {app.status === "approved"
                  ? "Approved"
                  : app.status === "rejected"
                    ? "Rejected"
                    : "Waiting for new documents"}
              </Status>
            ) : (
              <Status tone={rejected.length ? "alert" : "progress"}>
                {docs.filter((d) => d.status === "approved").length} of {docs.length} documents approved
              </Status>
            )}
            <p>
              {app.decisionNote ??
                (allApproved
                  ? "Every document checks out. Approve to send the onboarding video and kit pickup slot."
                  : rejected.length
                    ? "Ask for new documents to tell the rider exactly what to re-upload."
                    : "Open each document and check it against the NIC.")}
            </p>
          </div>
          <DrawerSection title="Applicant">
            <DetailList
              items={[
                ["Vehicle", vehicleLabels[app.vehicle]],
                [
                  "Wants to ride in",
                  app.zoneIds.map((z) => zones.data?.find((x) => x.id === z)?.code ?? z).join(", "),
                ],
                ["Applied", formatAgo(app.submittedAt, now)],
                ["Reference", app.id],
              ]}
            />
            <div className={styles.contactRow}>
              <Contact name={app.name} phone={app.phone} />
            </div>
          </DrawerSection>
          <DrawerSection title="Documents">
            <DocReview
              docs={docs}
              rejectReasons={riderDocReasons}
              pending={review.isPending || !!decided}
              onDecide={
                decided
                  ? undefined
                  : (docId, status, reason) =>
                      review.mutate(
                        { applicationId: app.id, docId, status, reason },
                        {
                          onError: (e) =>
                            toast({ title: "Not saved", description: e.message, tone: "error" }),
                        },
                      )
              }
            />
          </DrawerSection>
          {rejecting && <RejectApplicantSheet app={app} onClose={() => setRejecting(false)} />}
          <ConfirmDialog
            open={approving}
            onOpenChange={setApproving}
            title={`Approve ${app.name}?`}
            description="They can go online after the onboarding video. Their cash limit starts at Rs 15,000."
            confirmLabel="Approve rider"
            cancelLabel="Go back"
            onConfirm={() =>
              decide.mutate(
                { id: app.id, decision: "approved", note: "" },
                {
                  onSuccess: () =>
                    toast({
                      title: "Rider approved",
                      description: `${app.name} has been sent the onboarding link.`,
                      tone: "success",
                    }),
                  onError: (e) => toast({ title: "Not approved", description: e.message, tone: "error" }),
                },
              )
            }
          />
        </div>
      )}
    </Drawer>
  );
}
