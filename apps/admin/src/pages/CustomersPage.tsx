import {
  Button,
  DataTable,
  Drawer,
  Link,
  SearchField,
  Select,
  TextArea,
  TextField,
  cx,
  formatRs,
  useToast,
  type Column,
} from "@kade/ui";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { CustomerDetail, CustomerView } from "@/api/customers";
import { useCustomer, useCustomers, useIssueCredit, useResolveFlag, useSetBlocked } from "@/api/queries";
import type { FlagKind, FraudFlag } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { Contact } from "@/components/Contact";
import { DetailList, DrawerSection } from "@/components/DetailList";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Status } from "@/components/Status";
import { Toolbar } from "@/components/Toolbar";
import u from "@/components/ui.module.css";
import { statusLabels } from "@/features/orders/orderHelpers";
import { formatAgo, formatDate, formatWhen } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import { useSlashFocus } from "@/lib/useSlashFocus";
import styles from "./CustomersPage.module.css";

const flagLabels: Record<FlagKind, string> = {
  refunds: "Many refunds",
  cancellations: "Many cancellations",
  paymentFailures: "Payment failures",
};

/* ---------- Sheets ---------- */

const creditReasons = [
  "Late delivery",
  "Missing item",
  "Food quality",
  "Goodwill after a complaint",
  "App problem",
  "Other",
];

function CreditSheet({ c, onClose }: { c: CustomerDetail; onClose: () => void }) {
  const toast = useToast();
  const mutation = useIssueCredit();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState(creditReasons[0]!);
  const [note, setNote] = useState("");
  const value = Number(amount.replace(/[^\d]/g, "")) || 0;
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Issue credit to ${c.name}`}
      submitLabel={value ? `Issue ${formatRs(value)}` : "Issue credit"}
      pending={mutation.isPending}
      validate={() => {
        if (value < 1) return "Enter how much credit to give.";
        if (value > 5000) return "Credit over Rs 5,000 needs an admin. Ask Kasun to issue it.";
        if (reason === "Other" && !note.trim()) return "Say why you're giving credit.";
        return null;
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({
          id: c.id,
          amount: value,
          reason: note.trim() ? `${reason}: ${note.trim()}` : reason,
        });
        toast({
          title: "Credit issued",
          description: `${formatRs(value)} to ${c.name}. They get an SMS.`,
          tone: "success",
        });
      }}
    >
      <p className={u.muted}>
        Current balance {formatRs(c.credit)}. Credit doesn't expire and comes off their next order.
      </p>
      <TextField
        label="Amount"
        prefix="Rs"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        hint="Up to Rs 5,000."
      />
      <Select
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={creditReasons.map((x) => ({ value: x, label: x }))}
      />
      <TextArea
        label={reason === "Other" ? "What happened" : "Note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
      />
    </ActionSheet>
  );
}

function ClearFlagSheet({ c, flag, onClose }: { c: CustomerDetail; flag: FraudFlag; onClose: () => void }) {
  const toast = useToast();
  const mutation = useResolveFlag();
  const [note, setNote] = useState("");
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Clear "${flagLabels[flag.kind].toLowerCase()}" flag`}
      submitLabel="Clear flag"
      pending={mutation.isPending}
      validate={() =>
        note.trim() ? null : "Say what you checked, so the next person knows why it was cleared."
      }
      onSubmit={async () => {
        await mutation.mutateAsync({
          customerId: c.id,
          flagId: flag.id,
          outcome: "cleared",
          note: note.trim(),
        });
        toast({ title: "Flag cleared", description: c.name, tone: "success" });
      }}
    >
      <p className={u.muted}>{flag.detail}</p>
      <TextArea
        label="What you checked"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Called the restaurant; the items really were missing."
      />
    </ActionSheet>
  );
}

const blockReasons = [
  "Refund abuse",
  "Repeated cash orders refused at the door",
  "Card fraud suspected",
  "Abuse towards riders or staff",
  "Voucher abuse with new accounts",
];

function BlockSheet({ c, onClose }: { c: CustomerDetail; onClose: () => void }) {
  const toast = useToast();
  const mutation = useSetBlocked();
  const [reason, setReason] = useState(blockReasons[0]!);
  const [note, setNote] = useState("");
  const unblocking = c.blocked;
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={unblocking ? `Unblock ${c.name}` : `Block ${c.name}`}
      submitLabel={unblocking ? "Unblock customer" : "Block customer"}
      pending={mutation.isPending}
      validate={() => (unblocking && !note.trim() ? "Say why they're being unblocked." : null)}
      confirm={{
        title: unblocking ? `Unblock ${c.name}?` : `Block ${c.name}?`,
        description: unblocking
          ? "They can order again straight away."
          : `They can't place orders or use credit (${formatRs(c.credit)}). Open flags are marked as actioned. Orders already on the way carry on.`,
        confirmLabel: unblocking ? "Unblock customer" : "Block customer",
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({
          id: c.id,
          blocked: !unblocking,
          reason: unblocking ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason,
        });
        toast({
          title: unblocking ? "Customer unblocked" : "Customer blocked",
          description: c.name,
          tone: "success",
        });
      }}
    >
      {unblocking ? (
        <p className={u.muted}>Blocked for: {c.blockReason}</p>
      ) : (
        <Select
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          options={blockReasons.map((x) => ({ value: x, label: x }))}
        />
      )}
      <TextArea
        label={unblocking ? "Why unblock" : "Details (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
      />
    </ActionSheet>
  );
}

/* ---------- Drawer ---------- */

function CustomerDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const now = useNow(60_000);
  const query = useCustomer(id);
  const [sheet, setSheet] = useState<"credit" | "block" | null>(null);
  const [clearing, setClearing] = useState<FraudFlag | null>(null);
  const c = query.data;
  const openFlags = c?.flags.filter((f) => f.status === "open") ?? [];

  return (
    <Drawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={c?.name ?? "Customer"}
      closeLabel="Close customer"
      footer={
        c && (
          <div className={styles.footer}>
            <Button
              size="sm"
              icon="gift"
              variant="secondary"
              disabled={c.blocked}
              onClick={() => setSheet("credit")}
            >
              Issue credit
            </Button>
            <Button size="sm" variant={c.blocked ? "primary" : "outline"} onClick={() => setSheet("block")}>
              {c.blocked ? "Unblock" : "Block customer"}
            </Button>
          </div>
        )
      }
    >
      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        what="this customer"
      />
      {c && (
        <div className={styles.body}>
          <div className={cx(styles.summary, (c.blocked || openFlags.length > 0) && styles.summaryAlert)}>
            {c.blocked ? (
              <Status tone="stopped">Blocked</Status>
            ) : openFlags.length ? (
              <Status tone="alert">
                {openFlags.length} open {openFlags.length === 1 ? "flag" : "flags"} to review
              </Status>
            ) : (
              <Status tone="live">In good standing</Status>
            )}
            <p>
              {c.blocked
                ? c.blockReason
                : `${c.ordersCount} orders since ${formatDate(c.joinedOn)}, ${formatRs(c.spend)} spent. ${c.refundCount} refunds.`}
            </p>
          </div>

          <DrawerSection title="Fraud flags">
            {c.flags.length === 0 ? (
              <p className={u.muted}>
                No flags. The risk model flags many refunds, cancellations or failed payments.
              </p>
            ) : (
              <ul className={styles.flags}>
                {c.flags.map((f) => (
                  <li key={f.id} className={styles.flag}>
                    <div className={u.spread}>
                      {f.status === "open" ? (
                        <Status tone="alert">{flagLabels[f.kind]}</Status>
                      ) : (
                        <Status tone="done">
                          {flagLabels[f.kind]}, {f.status === "cleared" ? "cleared" : "actioned"}
                        </Status>
                      )}
                      <span className={cx(u.small, u.muted)}>{formatAgo(f.raisedAt, now)}</span>
                    </div>
                    <p>{f.detail}</p>
                    {f.resolution && <p className={cx(u.small, u.muted)}>{f.resolution}</p>}
                    {f.status === "open" && (
                      <div className={u.row}>
                        <button type="button" className={u.textButton} onClick={() => setClearing(f)}>
                          Looks genuine, clear flag
                        </button>
                        <button
                          type="button"
                          className={cx(u.textButton, u.textButtonAlert)}
                          onClick={() => setSheet("block")}
                        >
                          Block customer
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>

          <DrawerSection title={`Kadé credit: ${formatRs(c.credit)}`}>
            {c.creditHistory.length === 0 ? (
              <p className={u.muted}>No credit issued from the console yet.</p>
            ) : (
              <ul className={styles.history}>
                {c.creditHistory.map((h) => (
                  <li key={h.id}>
                    <span className={cx(u.num, u.strong)}>+{formatRs(h.amount)}</span>
                    <span>
                      {h.reason}
                      <span className={cx(u.small, u.muted)}>
                        {" "}
                        {h.by}, {formatWhen(h.at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DrawerSection>

          <DrawerSection title={`Refunds (${c.refunds.length})`}>
            {c.refunds.length === 0 ? (
              <p className={u.muted}>No refunds.</p>
            ) : (
              <table className={styles.mini}>
                <caption className="kd-visually-hidden">Refunds for {c.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {c.refunds.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/orders?order=${r.orderId}&date=week`} className={u.textButton}>
                          {r.orderId}
                        </Link>
                      </td>
                      <td>
                        {r.reason}
                        <span className={cx(u.small, u.muted)}> {formatDate(r.at)}</span>
                      </td>
                      <td className={u.num}>{formatRs(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </DrawerSection>

          <DrawerSection title="Recent orders">
            <table className={styles.mini}>
              <caption className="kd-visually-hidden">Recent orders for {c.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Restaurant</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {c.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders?order=${o.id}&date=week`} className={u.textButton}>
                        {o.id}
                      </Link>
                    </td>
                    <td>
                      {o.restaurantName}
                      <span className={cx(u.small, u.muted)}>
                        {" "}
                        {formatDate(o.placedAt)}, {statusLabels[o.status].toLowerCase()}
                      </span>
                    </td>
                    <td className={u.num}>{formatRs(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DrawerSection>

          <DrawerSection title="Contact">
            <DetailList
              items={[
                ["Customer id", c.id],
                ["Area", c.area],
                ["Email", c.email],
              ]}
            />
            <div className={styles.contactRow}>
              <Contact name={c.name} phone={c.phone} email={c.email} />
            </div>
          </DrawerSection>

          {sheet === "credit" && <CreditSheet c={c} onClose={() => setSheet(null)} />}
          {sheet === "block" && <BlockSheet c={c} onClose={() => setSheet(null)} />}
          {clearing && <ClearFlagSheet c={c} flag={clearing} onClose={() => setClearing(null)} />}
        </div>
      )}
    </Drawer>
  );
}

/* ---------- Page ---------- */

export function CustomersPage() {
  useDocumentTitle("Customers");
  const [params, setParams] = useSearchParams();
  const query = useCustomers();
  const [q, setQ] = useState("");
  const [show, setShow] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useSlashFocus(ref);
  const id = params.get("id");

  const needle = q.trim().toLowerCase();
  const rows = (query.data ?? [])
    .filter(
      (c) =>
        (!needle ||
          c.name.toLowerCase().includes(needle) ||
          c.id.toLowerCase().includes(needle) ||
          c.email.includes(needle) ||
          c.phone.replaceAll(" ", "").includes(needle.replaceAll(" ", ""))) &&
        (!show ||
          (show === "flagged" && c.openFlags > 0) ||
          (show === "blocked" && c.blocked) ||
          (show === "credit" && c.credit > 0) ||
          (show === "refunds" && c.refundCount >= 3)),
    )
    .sort((a, b) => b.openFlags - a.openFlags || a.name.localeCompare(b.name));
  const flagged = query.data?.filter((c) => c.openFlags > 0).length ?? 0;

  const columns: Column<CustomerView>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (c) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{c.name}</span>
          <span>{c.id}</span>
        </span>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      hideOnNarrow: true,
      cell: (c) => <span className={u.num}>{c.phone}</span>,
    },
    { key: "area", header: "Area", hideOnNarrow: true, cell: (c) => c.area },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      cell: (c) => <span className={u.num}>{c.ordersCount}</span>,
    },
    {
      key: "refunds",
      header: "Refunds",
      align: "right",
      cell: (c) => (
        <span className={cx(u.num, c.refundCount >= 5 && u.alertText)}>
          {c.refundCount ? `${c.refundCount}, ${formatRs(c.refundTotal)}` : "–"}
        </span>
      ),
    },
    {
      key: "credit",
      header: "Credit",
      align: "right",
      hideOnNarrow: true,
      cell: (c) => (
        <span className={cx(u.num, !c.credit && u.muted)}>{c.credit ? formatRs(c.credit) : "–"}</span>
      ),
    },
    {
      key: "flags",
      header: "Standing",
      cell: (c) =>
        c.blocked ? (
          <Status tone="stopped">Blocked</Status>
        ) : c.openFlags ? (
          <Status tone="alert">
            {c.openFlags} {c.openFlags === 1 ? "flag" : "flags"} to review
          </Status>
        ) : (
          <span className={u.muted}>Good</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description={
          flagged
            ? `${flagged} customers have fraud flags to review.`
            : "Look up a customer, issue credit or review fraud flags."
        }
      />
      <Toolbar
        label="Filter customers"
        count={query.data ? `${rows.length} customers` : undefined}
        onClear={q || show ? () => (setQ(""), setShow("")) : undefined}
      >
        <SearchField
          ref={ref}
          label="Search customers"
          placeholder="Name, phone, email or id ( / )"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Show"
          value={show}
          onChange={(e) => setShow(e.target.value)}
          options={[
            { value: "", label: "Everyone" },
            { value: "flagged", label: "Open fraud flags" },
            { value: "refunds", label: "3 or more refunds" },
            { value: "credit", label: "Has Kadé credit" },
            { value: "blocked", label: "Blocked" },
          ]}
        />
      </Toolbar>
      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        what="customers"
      />
      {query.data && (
        <DataTable
          caption="Customers. Choose a row to open the customer."
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          onRowClick={(c) => setParams({ id: c.id }, { replace: true })}
          selectedKey={id ?? undefined}
          empty="No customers match. Search by phone number without spaces, or clear the filter."
        />
      )}
      <CustomerDrawer id={id} onClose={() => setParams({}, { replace: true })} />
    </>
  );
}
