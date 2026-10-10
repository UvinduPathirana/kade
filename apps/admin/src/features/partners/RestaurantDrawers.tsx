import { Button, ConfirmDialog, Drawer, Select, TextArea, TextField, cx, useToast } from "@kade/ui";
import { useState } from "react";
import {
  useDecideRestaurantApplication,
  useSetRestaurantDocStatus,
  useSetRestaurantStatus,
  useUpdateCommission,
} from "@/api/queries";
import type { Restaurant, RestaurantApplication, RestaurantStatus } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { Contact } from "@/components/Contact";
import { DetailList, DrawerSection } from "@/components/DetailList";
import { DocReview } from "@/components/DocReview";
import { Status } from "@/components/Status";
import u from "@/components/ui.module.css";
import { formatAgo, formatDate, formatPercent } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import styles from "./Partners.module.css";

export function RestaurantStatusTag({ r }: { r: Restaurant }) {
  if (r.status === "open" && !r.accepting) return <Status tone="alert">Not accepting</Status>;
  switch (r.status) {
    case "open":
      return <Status tone="live">Open</Status>;
    case "paused":
      return <Status tone="progress">Paused</Status>;
    case "suspended":
      return <Status tone="stopped">Suspended</Status>;
    case "closed":
      return <Status tone="done">Closed</Status>;
  }
}

/* ---------- Pause, suspend, reopen ---------- */

const pauseReasons = [
  "Asked by the restaurant",
  "Kitchen not accepting orders",
  "Too many late orders today",
  "Menu or prices need fixing",
];
const suspendReasons = [
  "Food safety complaint under review",
  "Repeated missing items",
  "Documents expired",
  "Unpaid balance with Kadé",
  "Breach of partner agreement",
];

function StatusSheet({
  r,
  next,
  onClose,
}: {
  r: Restaurant;
  next: Exclude<RestaurantStatus, "open" | "closed">;
  onClose: () => void;
}) {
  const toast = useToast();
  const mutation = useSetRestaurantStatus();
  const reasons = next === "paused" ? pauseReasons : suspendReasons;
  const [reason, setReason] = useState(reasons[0]!);
  const [detail, setDetail] = useState("");
  const full = detail.trim() ? `${reason}: ${detail.trim()}` : reason;
  const verb = next === "paused" ? "Pause" : "Suspend";

  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${verb} ${r.name}`}
      submitLabel={`${verb} restaurant`}
      pending={mutation.isPending}
      validate={() =>
        next === "suspended" && !detail.trim() ? "Add the details. The owner sees this reason." : null
      }
      confirm={
        next === "suspended"
          ? {
              title: `Suspend ${r.name}?`,
              description: `They disappear from the app and can't take orders until someone reopens them. ${r.owner} gets an email with your reason.`,
              confirmLabel: "Suspend restaurant",
            }
          : undefined
      }
      onSubmit={async () => {
        await mutation.mutateAsync({ id: r.id, status: next, reason: full });
        toast({
          title: next === "paused" ? "Restaurant paused" : "Restaurant suspended",
          description: r.name,
          tone: "success",
        });
      }}
    >
      <p className={u.muted}>
        {next === "paused"
          ? "Pausing hides the restaurant until you or they reopen it. Orders already placed carry on."
          : "Suspending is for serious problems. The restaurant can't reopen themselves."}
      </p>
      <Select
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={reasons.map((x) => ({ value: x, label: x }))}
      />
      <TextArea
        label={next === "suspended" ? "Details for the owner" : "Details (optional)"}
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={3}
      />
    </ActionSheet>
  );
}

/* ---------- Restaurant detail ---------- */

export function RestaurantDrawer({ r, onClose }: { r: Restaurant | undefined; onClose: () => void }) {
  const toast = useToast();
  const commission = useUpdateCommission();
  const setStatus = useSetRestaurantStatus();
  const [rate, setRate] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string>();
  const [sheet, setSheet] = useState<"paused" | "suspended" | null>(null);
  const [reopening, setReopening] = useState(false);
  const value = rate ?? String(r?.commission ?? "");

  return (
    <Drawer
      open={!!r}
      onOpenChange={(o) => {
        if (!o) {
          setRate(null);
          setRateError(undefined);
          onClose();
        }
      }}
      title={r?.name ?? "Restaurant"}
      closeLabel="Close restaurant"
      footer={
        r && (
          <div className={styles.footer}>
            {r.status === "open" ? (
              <>
                <Button size="sm" variant="secondary" icon="pause" onClick={() => setSheet("paused")}>
                  Pause
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSheet("suspended")}>
                  Suspend
                </Button>
              </>
            ) : (
              <Button size="sm" icon="play" onClick={() => setReopening(true)}>
                Reopen
              </Button>
            )}
          </div>
        )
      }
    >
      {r && (
        <div className={styles.body}>
          <div className={styles.summary}>
            <RestaurantStatusTag r={r} />
            <p>
              {r.status === "open" && !r.accepting
                ? `The tablet stopped responding. Oldest order has waited ${r.waitingMinutes ?? 5} min. Call the kitchen.`
                : (r.statusReason ?? `${r.cuisine} in ${r.area}. Delivers in about ${r.etaMin} min.`)}
            </p>
          </div>

          <DrawerSection title="This week">
            <dl className={styles.figures}>
              <div>
                <dt>Rating</dt>
                <dd>{r.rating ? `★ ${r.rating.toFixed(1)}` : "New"}</dd>
              </div>
              <div>
                <dt>Orders</dt>
                <dd>{r.ordersWeek}</dd>
              </div>
              <div>
                <dt>Accepted</dt>
                <dd className={cx(r.acceptanceRate < 0.85 && u.alertText)}>
                  {formatPercent(r.acceptanceRate)}
                </dd>
              </div>
            </dl>
          </DrawerSection>

          <DrawerSection title="Commission">
            <form
              className={styles.inline}
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(value);
                if (!value.trim() || !Number.isFinite(n) || n < 0 || n > 35) {
                  setRateError("Enter a whole number from 0 to 35.");
                  return;
                }
                setRateError(undefined);
                commission.mutate(
                  { id: r.id, commission: n },
                  {
                    onSuccess: () => {
                      setRate(null);
                      toast({
                        title: "Commission changed",
                        description: `${r.name} pays ${n}% from next week's payout.`,
                        tone: "success",
                      });
                    },
                    onError: (err) => setRateError(err.message),
                  },
                );
              }}
            >
              <TextField
                label="Commission, %"
                inputMode="numeric"
                value={value}
                onChange={(e) => setRate(e.target.value)}
                error={rateError}
                hint="Kadé's standard rate is 18%. Changes apply from next week's payout."
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={commission.isPending || value === String(r.commission)}
              >
                Save
              </Button>
            </form>
          </DrawerSection>

          <DrawerSection title="Contact">
            <DetailList
              items={[
                ["Owner", r.owner],
                ["Joined", formatDate(r.joinedOn)],
                ["Payouts to", r.bank],
              ]}
            />
            <div className={styles.contactRow}>
              <Contact name={r.name} phone={r.phone} email={r.email} />
            </div>
          </DrawerSection>

          {sheet && <StatusSheet r={r} next={sheet} onClose={() => setSheet(null)} />}
          <ConfirmDialog
            open={reopening}
            onOpenChange={setReopening}
            title={`Reopen ${r.name}?`}
            description="Customers can order straight away, as long as the kitchen tablet is online."
            confirmLabel="Reopen restaurant"
            cancelLabel="Go back"
            onConfirm={() =>
              setStatus.mutate(
                { id: r.id, status: "open", reason: "" },
                {
                  onSuccess: () =>
                    toast({ title: "Restaurant reopened", description: r.name, tone: "success" }),
                },
              )
            }
          />
        </div>
      )}
    </Drawer>
  );
}

/* ---------- Application review ---------- */

const docRejectReasons = [
  "Photo is blurry or cut off",
  "Document has expired",
  "Name doesn't match the owner's NIC",
  "Wrong document uploaded",
  "Registration number can't be verified",
];

type Decision = "approved" | "changesRequested" | "rejected";

function DecisionSheet({
  app,
  decision,
  onClose,
}: {
  app: RestaurantApplication;
  decision: Exclude<Decision, "approved">;
  onClose: () => void;
}) {
  const toast = useToast();
  const mutation = useDecideRestaurantApplication();
  const rejectedDocs = app.documents.filter((d) => d.status === "rejected").map((d) => d.kind.toLowerCase());
  const [note, setNote] = useState(
    decision === "changesRequested" && rejectedDocs.length
      ? `Please upload a new ${rejectedDocs.join(" and ")}.`
      : "",
  );
  const [reason, setReason] = useState("Outside our delivery zones");
  const rejectReasons = [
    "Outside our delivery zones",
    "Food safety certificate missing",
    "Duplicate of an existing partner",
    "Business couldn't be verified",
  ];

  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={decision === "rejected" ? `Reject ${app.name}` : `Ask ${app.name} for changes`}
      submitLabel={decision === "rejected" ? "Reject application" : "Send request"}
      pending={mutation.isPending}
      validate={() =>
        decision === "changesRequested" && !note.trim() ? "Say exactly what they need to fix." : null
      }
      confirm={
        decision === "rejected"
          ? {
              title: `Reject ${app.name}?`,
              description: `${app.owner} is emailed your reason. They can apply again after 30 days.`,
              confirmLabel: "Reject application",
            }
          : undefined
      }
      onSubmit={async () => {
        const full =
          decision === "rejected" ? (note.trim() ? `${reason}. ${note.trim()}` : reason) : note.trim();
        await mutation.mutateAsync({ id: app.id, decision, note: full });
        toast({
          title: decision === "rejected" ? "Application rejected" : "Changes requested",
          description: `${app.owner} has been emailed.`,
          tone: "success",
        });
        onClose();
      }}
    >
      {decision === "rejected" && (
        <Select
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          options={rejectReasons.map((x) => ({ value: x, label: x }))}
        />
      )}
      <TextArea
        label={decision === "rejected" ? "Anything to add (optional)" : "Message to the owner"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
      />
    </ActionSheet>
  );
}

export function ApplicationDrawer({
  app,
  onClose,
}: {
  app: RestaurantApplication | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const now = useNow(60_000);
  const docMutation = useSetRestaurantDocStatus();
  const decide = useDecideRestaurantApplication();
  const [sheet, setSheet] = useState<"changesRequested" | "rejected" | null>(null);
  const [approving, setApproving] = useState(false);
  const allApproved = app?.documents.every((d) => d.status === "approved");
  const reviewed = app?.documents.filter((d) => d.status !== "pending").length ?? 0;
  const decided = app && app.status !== "pending";

  return (
    <Drawer
      open={!!app}
      onOpenChange={(o) => !o && onClose()}
      title={app?.name ?? "Application"}
      closeLabel="Close application"
      footer={
        app &&
        !decided && (
          <div className={styles.footer}>
            <Button
              size="sm"
              icon="check"
              disabled={!allApproved || decide.isPending}
              onClick={() => setApproving(true)}
            >
              Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSheet("changesRequested")}>
              Request changes
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSheet("rejected")}>
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
                    : "Waiting for the owner"}
              </Status>
            ) : (
              <Status tone="progress">
                {reviewed} of {app.documents.length} documents reviewed
              </Status>
            )}
            <p>
              {app.decisionNote ??
                (allApproved
                  ? "Every document checks out. Approve to set up their menu and tablet."
                  : "Check each document against the owner's details, then decide.")}
            </p>
          </div>
          <DrawerSection title="Applicant">
            <DetailList
              items={[
                ["Cuisine", app.cuisine],
                ["Area", app.area],
                ["Owner", app.owner],
                ["Applied", formatAgo(app.submittedAt, now)],
                ["Reference", app.id],
              ]}
            />
            <div className={styles.contactRow}>
              <Contact name={app.owner} phone={app.phone} email={app.email} />
            </div>
          </DrawerSection>
          <DrawerSection title="Documents">
            <DocReview
              docs={app.documents}
              rejectReasons={docRejectReasons}
              pending={docMutation.isPending || !!decided}
              onDecide={
                decided
                  ? undefined
                  : (docId, status) => docMutation.mutate({ applicationId: app.id, docId, status })
              }
            />
          </DrawerSection>
          {sheet && <DecisionSheet app={app} decision={sheet} onClose={() => setSheet(null)} />}
          <ConfirmDialog
            open={approving}
            onOpenChange={setApproving}
            title={`Approve ${app.name}?`}
            description={`They join at 18% commission. ${app.owner} gets the partner agreement and tablet set-up steps by email.`}
            confirmLabel="Approve restaurant"
            cancelLabel="Go back"
            onConfirm={() =>
              decide.mutate(
                { id: app.id, decision: "approved", note: "" },
                {
                  onSuccess: () =>
                    toast({
                      title: "Restaurant approved",
                      description: `${app.name} is being set up.`,
                      tone: "success",
                    }),
                },
              )
            }
          />
        </div>
      )}
    </Drawer>
  );
}
