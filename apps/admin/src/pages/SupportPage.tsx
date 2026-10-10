import {
  Button,
  Choice,
  DataTable,
  Link,
  Select,
  Switch,
  TextArea,
  TextField,
  cx,
  formatRs,
  useToast,
  type Column,
} from "@kade/ui";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { ME } from "@/api/client";
import {
  useAssignTicket,
  useMacros,
  useOrder,
  useReopenTicket,
  useReplyToTicket,
  useResolveTicket,
  useSetTicketPriority,
  useStaffNames,
  useTickets,
} from "@/api/queries";
import type { RefundMethod, Ticket, TicketCategory, TicketPriority } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Status } from "@/components/Status";
import { Toolbar } from "@/components/Toolbar";
import u from "@/components/ui.module.css";
import { OPS_REFUND_LIMIT } from "@/features/orders/OrderSheets";
import { formatClock, formatMinutes, formatWhen } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./SupportPage.module.css";

const categoryLabels: Record<TicketCategory, string> = {
  missingItem: "Missing item",
  wrongItem: "Wrong item",
  late: "Late or cold",
  payment: "Payment",
  rider: "Rider",
  account: "Account",
  restaurant: "Restaurant",
};

const priorityLabels: Record<TicketPriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};
const priorityRank: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function Sla({ t, now }: { t: Ticket; now: number }) {
  if (t.status === "resolved") return <Status tone="done">Resolved</Status>;
  if (t.status === "pending") return <Status tone="progress">Waiting on them</Status>;
  const min = Math.round((t.slaDueAt - now) / 60_000);
  if (min < 0) return <Status tone="alert">Overdue {formatMinutes(-min)}</Status>;
  return <span className={cx(u.num, min <= 5 && u.strong)}>{formatMinutes(Math.max(1, min))} left</span>;
}

const requesterHref = (t: Ticket) =>
  t.requester.kind === "customer"
    ? `/customers?id=${t.requester.id}`
    : t.requester.kind === "rider"
      ? `/riders?id=${t.requester.id}`
      : `/restaurants?id=${t.requester.id}`;

/* ---------- Resolve ---------- */

function ResolveSheet({ t, onClose }: { t: Ticket; onClose: () => void }) {
  const toast = useToast();
  const mutation = useResolveTicket();
  const order = useOrder(t.orderId ?? null);
  const o = order.data;
  const refundable = o ? o.total - o.refunded : 0;
  const isCustomer = t.requester.kind === "customer";
  const [kind, setKind] = useState<"refund" | "credit" | "none">(
    o ? "refund" : isCustomer ? "credit" : "none",
  );
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<RefundMethod>("credit");
  const [note, setNote] = useState("");
  const value = Number(amount.replace(/[^\d]/g, "")) || 0;

  return (
    <ActionSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Resolve ${t.id}`}
      submitLabel={
        kind === "refund" && value
          ? `Refund ${formatRs(value)} and resolve`
          : kind === "credit" && value
            ? `Give ${formatRs(value)} and resolve`
            : "Resolve ticket"
      }
      pending={mutation.isPending}
      validate={() => {
        if (kind !== "none" && value < 1) return "Enter an amount.";
        if (kind === "refund" && value > refundable)
          return `You can refund up to ${formatRs(refundable)} on ${o?.id}.`;
        if (kind === "refund" && value > OPS_REFUND_LIMIT)
          return `Refunds over ${formatRs(OPS_REFUND_LIMIT)} need finance or an admin.`;
        if (kind === "credit" && value > 5000) return "Credit over Rs 5,000 needs an admin.";
        if (kind === "none" && !note.trim()) return "Say how it was resolved, for the record.";
        return null;
      }}
      confirm={
        kind === "refund"
          ? {
              title: `Refund ${formatRs(value)} to ${method === "card" ? "card" : "Kadé credit"}?`,
              description: `On ${o?.id}. ${t.requester.name} is told by SMS. Refunds can't be reversed.`,
              confirmLabel: `Refund ${formatRs(value)}`,
            }
          : undefined
      }
      onSubmit={async () => {
        await mutation.mutateAsync({
          id: t.id,
          note: note.trim(),
          resolution:
            kind === "refund"
              ? { kind, amount: value, method }
              : kind === "credit"
                ? { kind, amount: value }
                : { kind },
        });
        toast({ title: "Ticket resolved", description: t.subject, tone: "success" });
      }}
    >
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>Outcome</legend>
        <Choice
          type="radio"
          name="outcome"
          checked={kind === "refund"}
          disabled={!o}
          onChange={() => setKind("refund")}
          label={o ? `Refund ${o.id}` : "Refund (no linked order)"}
          meta={o ? `up to ${formatRs(refundable)}` : undefined}
        />
        <Choice
          type="radio"
          name="outcome"
          checked={kind === "credit"}
          disabled={!isCustomer}
          onChange={() => setKind("credit")}
          label={isCustomer ? "Give Kadé credit" : "Kadé credit (customers only)"}
        />
        <Choice
          type="radio"
          name="outcome"
          checked={kind === "none"}
          onChange={() => setKind("none")}
          label="No compensation"
        />
      </fieldset>
      {kind !== "none" && (
        <TextField
          label="Amount"
          prefix="Rs"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      )}
      {kind === "refund" && o && (
        <Select
          label="Refund to"
          value={method}
          onChange={(e) => setMethod(e.target.value as RefundMethod)}
          options={[
            { value: "credit", label: "Kadé credit, ready now" },
            ...(o.payment === "card"
              ? [{ value: "card", label: `Card ending ${o.cardLast4}, 5 to 7 working days` }]
              : []),
          ]}
        />
      )}
      <TextArea
        label={kind === "none" ? "How it was resolved" : "Note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
      />
    </ActionSheet>
  );
}

/* ---------- Ticket detail ---------- */

function TicketDetail({ t, now }: { t: Ticket; now: number }) {
  const toast = useToast();
  const staff = useStaffNames();
  const macros = useMacros();
  const reply = useReplyToTicket();
  const assign = useAssignTicket();
  const priority = useSetTicketPriority();
  const reopen = useReopenTicket();
  const [draft, setDraft] = useState("");
  const [resolving, setResolving] = useState(false);
  const first = t.requester.name.split(" ")[0];

  const send = () => {
    if (!draft.trim()) return;
    reply.mutate(
      { id: t.id, body: draft },
      {
        onSuccess: () => {
          setDraft("");
          toast({ title: "Reply sent", description: `${first} gets it by SMS and in the app.` });
        },
        onError: (e) => toast({ title: "Reply not sent", description: e.message, tone: "error" }),
      },
    );
  };

  return (
    <article className={cx(u.surface, styles.detail)} aria-labelledby="ticket-title">
      <header className={styles.detailHead}>
        <div>
          <p className={cx(u.small, u.muted)}>
            {t.id}, {categoryLabels[t.category].toLowerCase()}, opened {formatWhen(t.openedAt)}
          </p>
          <h2 id="ticket-title" className={styles.subject}>
            {t.subject}
          </h2>
          <p className={u.row}>
            <Link href={requesterHref(t)} className={u.textButton}>
              {t.requester.name}
            </Link>
            <span className={u.muted}>{t.requester.kind}</span>
            {t.orderId && (
              <>
                <span className={u.muted} aria-hidden="true">
                  |
                </span>
                <Link href={`/orders?order=${t.orderId}`} className={u.textButton}>
                  Order {t.orderId}
                </Link>
              </>
            )}
          </p>
        </div>
        <Sla t={t} now={now} />
      </header>

      <div className={styles.controls}>
        <Select
          label="Priority"
          value={t.priority}
          onChange={(e) => priority.mutate({ id: t.id, priority: e.target.value as TicketPriority })}
          options={(Object.keys(priorityLabels) as TicketPriority[]).map((p) => ({
            value: p,
            label: priorityLabels[p],
          }))}
        />
        <Select
          label="Assigned to"
          value={t.assigneeId ?? ""}
          onChange={(e) =>
            assign.mutate(
              { id: t.id, assigneeId: e.target.value || null },
              { onSuccess: () => toast({ title: e.target.value ? "Ticket assigned" : "Ticket unassigned" }) },
            )
          }
          options={[
            { value: "", label: "Nobody" },
            ...(staff.data ?? []).map((s) => ({
              value: s.id,
              label: s.id === ME.id ? `${s.name} (you)` : s.name,
            })),
          ]}
        />
        {t.status === "resolved" ? (
          <Button size="sm" variant="secondary" onClick={() => reopen.mutate(t.id)}>
            Reopen
          </Button>
        ) : (
          <Button size="sm" icon="check" onClick={() => setResolving(true)}>
            Resolve
          </Button>
        )}
      </div>

      <ol className={styles.thread} aria-label="Conversation">
        {t.messages.map((m) => (
          <li key={m.id} className={cx(styles.message, styles[m.from])}>
            {m.from !== "system" && (
              <p className={styles.meta}>
                <strong>{m.author}</strong> {formatClock(m.at)}
              </p>
            )}
            <p>{m.body}</p>
            {m.from === "system" && <span className={styles.meta}> {formatClock(m.at)}</span>}
          </li>
        ))}
      </ol>

      {t.status !== "resolved" ? (
        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className={styles.macros} role="group" aria-label="Quick replies">
            {(macros.data ?? []).map((m) => (
              <button
                key={m.id}
                type="button"
                className={styles.macro}
                onClick={() => setDraft((d) => `${d ? `${d}\n\n` : ""}${m.body}`)}
              >
                {m.title}
              </button>
            ))}
          </div>
          <TextArea
            label={`Reply to ${first}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            rows={4}
            placeholder="Write a reply, or start from a quick reply above."
          />
          <div className={u.spread}>
            <span className={cx(u.small, u.muted)}>
              <kbd className={u.kbd}>Ctrl</kbd> + <kbd className={u.kbd}>Enter</kbd> sends
            </span>
            <Button type="submit" size="sm" disabled={!draft.trim() || reply.isPending}>
              Send reply
            </Button>
          </div>
        </form>
      ) : (
        <p className={styles.resolved}>{t.resolution}</p>
      )}
      {resolving && <ResolveSheet t={t} onClose={() => setResolving(false)} />}
    </article>
  );
}

/* ---------- Page ---------- */

export function SupportPage() {
  useDocumentTitle("Support");
  const now = useNow(1000);
  const [params, setParams] = useSearchParams();
  const query = useTickets();
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("active");
  const [mine, setMine] = useState(false);
  const selectedId = params.get("ticket");

  const rows = (query.data ?? [])
    .filter(
      (t) =>
        (!category || t.category === category) &&
        (status === "" || (status === "active" ? t.status !== "resolved" : t.status === status)) &&
        (!mine || t.assigneeId === ME.id),
    )
    .sort(
      (a, b) =>
        Number(a.status === "resolved") - Number(b.status === "resolved") ||
        Number(a.status === "pending") - Number(b.status === "pending") ||
        a.slaDueAt - b.slaDueAt ||
        priorityRank[a.priority] - priorityRank[b.priority],
    );
  const selected = query.data?.find((t) => t.id === selectedId) ?? rows[0];
  const overdue = query.data?.filter((t) => t.status === "open" && t.slaDueAt < now).length ?? 0;
  const open = query.data?.filter((t) => t.status !== "resolved").length ?? 0;

  const columns: Column<Ticket>[] = [
    {
      key: "priority",
      header: "Priority",
      cell: (t) =>
        t.priority === "urgent" ? (
          <Status tone="alert">Urgent</Status>
        ) : (
          <span className={cx(t.priority === "high" && u.strong)}>{priorityLabels[t.priority]}</span>
        ),
    },
    {
      key: "subject",
      header: "Ticket",
      cell: (t) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{t.subject}</span>
          <span>
            {t.requester.name}, {categoryLabels[t.category].toLowerCase()}
          </span>
        </span>
      ),
    },
    { key: "sla", header: "Reply due", cell: (t) => <Sla t={t} now={now} /> },
  ];

  return (
    <>
      <PageHeader
        title="Support"
        description={`${open} open tickets${overdue ? `, ${overdue} past their reply time` : ""}. Oldest reply due first.`}
      />
      <Toolbar label="Filter tickets" count={query.data ? `${rows.length} tickets` : undefined}>
        <Select
          label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[
            { value: "", label: "All categories" },
            ...(Object.keys(categoryLabels) as TicketCategory[]).map((c) => ({
              value: c,
              label: categoryLabels[c],
            })),
          ]}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "active", label: "Open and waiting" },
            { value: "open", label: "Needs a reply" },
            { value: "pending", label: "Waiting on them" },
            { value: "resolved", label: "Resolved" },
            { value: "", label: "All" },
          ]}
        />
        <Switch checked={mine} onChange={setMine} label="Assigned to me" className={styles.mine} />
      </Toolbar>
      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        what="tickets"
      />
      {query.data && (
        <div className={styles.layout}>
          <DataTable
            caption="Support queue. Choose a ticket to open the conversation."
            columns={columns}
            rows={rows}
            rowKey={(t) => t.id}
            onRowClick={(t) => setParams({ ticket: t.id }, { replace: true })}
            selectedKey={selected?.id}
            className={styles.queue}
            empty={
              mine
                ? "Nothing assigned to you. Turn off “Assigned to me” to see the whole queue."
                : "No tickets match."
            }
          />
          {selected ? (
            <TicketDetail key={selected.id} t={selected} now={now} />
          ) : (
            <p className={cx(u.surface, u.surfacePad, u.muted)}>Choose a ticket to read the conversation.</p>
          )}
        </div>
      )}
    </>
  );
}
