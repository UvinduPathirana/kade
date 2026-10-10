import {
  Button,
  ConfirmDialog,
  DataTable,
  Link,
  SearchField,
  Select,
  Switch,
  Tabs,
  TextField,
  cx,
  formatRs,
  useToast,
  type Column,
} from "@kade/ui";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { CashView, PayoutBatchView, RefundView, SettlementView } from "@/api/finance";
import {
  useApprovePayoutBatch,
  useCashRecords,
  usePayoutBatches,
  useRecordDeposit,
  useRefunds,
  useRiderSettlements,
  useSettleRider,
} from "@/api/queries";
import { ActionSheet } from "@/components/ActionSheet";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Status } from "@/components/Status";
import { Toolbar } from "@/components/Toolbar";
import u from "@/components/ui.module.css";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatWhen } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./FinancePage.module.css";

type Tab = "payouts" | "settlements" | "cash" | "refunds";

/* ---------- Restaurant payouts ---------- */

function Payouts({ batches }: { batches: PayoutBatchView[] }) {
  const toast = useToast();
  const approve = useApprovePayoutBatch();
  const [batchId, setBatchId] = useState(batches[0]!.id);
  const [confirming, setConfirming] = useState(false);
  const b = batches.find((x) => x.id === batchId) ?? batches[0]!;

  const columns: Column<PayoutBatchView["lines"][number]>[] = [
    { key: "name", header: "Restaurant", cell: (l) => <span className={u.strong}>{l.restaurantName}</span> },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      cell: (l) => <span className={u.num}>{l.orders}</span>,
    },
    {
      key: "gross",
      header: "Gross sales",
      align: "right",
      cell: (l) => <span className={u.num}>{formatRs(l.gross)}</span>,
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      cell: (l) => (
        <span className={u.cellStack}>
          <span className={u.num}>{formatRs(l.commission)}</span>
          <span className={u.num}>{l.commissionRate}%</span>
        </span>
      ),
    },
    {
      key: "adj",
      header: "Refunds charged",
      align: "right",
      hideOnNarrow: true,
      cell: (l) => (
        <span className={cx(u.num, !l.adjustments && u.muted)}>
          {l.adjustments ? `−${formatRs(-l.adjustments)}` : "–"}
        </span>
      ),
    },
    {
      key: "net",
      header: "Payout",
      align: "right",
      cell: (l) => <span className={cx(u.num, u.strong)}>{formatRs(l.net)}</span>,
    },
    {
      key: "bank",
      header: "Paid into",
      hideOnNarrow: true,
      cell: (l) => <span className={u.muted}>{l.bank}</span>,
    },
  ];

  return (
    <div className={u.stack}>
      <div className={cx(u.surface, styles.batch)}>
        <Select
          label="Payout week"
          value={b.id}
          onChange={(e) => setBatchId(e.target.value)}
          options={batches.map((x) => ({
            value: x.id,
            label: `${x.week}${x.status === "draft" ? ", waiting for approval" : ""}`,
          }))}
          className={styles.batchSelect}
        />
        <dl className={styles.batchFigures}>
          <div>
            <dt>Gross sales</dt>
            <dd>{formatRs(b.totals.gross)}</dd>
          </div>
          <div>
            <dt>Kadé commission</dt>
            <dd>{formatRs(b.totals.commission)}</dd>
          </div>
          <div>
            <dt>Refunds charged</dt>
            <dd>−{formatRs(-b.totals.adjustments)}</dd>
          </div>
          <div>
            <dt>To pay {b.lines.length} restaurants</dt>
            <dd className={styles.batchNet}>{formatRs(b.totals.net)}</dd>
          </div>
        </dl>
        <div className={styles.batchAction}>
          {b.status === "draft" ? (
            <>
              <Button icon="check" onClick={() => setConfirming(true)} disabled={approve.isPending}>
                Approve batch
              </Button>
              <span className={cx(u.small, u.muted)}>Bank transfers go out {formatDate(b.payDate)}</span>
            </>
          ) : (
            <>
              <Status tone={b.status === "paid" ? "done" : "live"}>
                {b.status === "paid" ? "Paid" : "Approved"}
              </Status>
              <span className={cx(u.small, u.muted)}>
                {b.status === "paid" ? `Paid ${formatDate(b.payDate)}` : `Pays ${formatDate(b.payDate)}`}.
                Approved by {b.approvedBy}
              </span>
            </>
          )}
        </div>
      </div>

      <DataTable
        caption={`Restaurant payouts for ${b.week}`}
        columns={columns}
        rows={b.lines}
        rowKey={(l) => String(l.restaurantId)}
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Approve ${formatRs(b.totals.net)} for ${b.lines.length} restaurants?`}
        description={`Payouts for ${b.week} go out by bank transfer on ${formatDate(b.payDate)}. Once approved, the batch can't be edited; adjustments move to next week.`}
        confirmLabel="Approve batch"
        cancelLabel="Go back"
        onConfirm={() =>
          approve.mutate(b.id, {
            onSuccess: () =>
              toast({
                title: "Payout batch approved",
                description: `${b.week}, ${formatRs(b.totals.net)}.`,
                tone: "success",
              }),
            onError: (e) => toast({ title: "Batch not approved", description: e.message, tone: "error" }),
          })
        }
      />
    </div>
  );
}

/* ---------- Rider settlements ---------- */

function Settlements({ rows: all }: { rows: SettlementView[] }) {
  const toast = useToast();
  const settle = useSettleRider();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("open");
  const [direction, setDirection] = useState("");
  const [confirm, setConfirm] = useState<SettlementView | null>(null);

  const rows = all.filter(
    (s) =>
      (!q ||
        s.riderName.toLowerCase().includes(q.toLowerCase()) ||
        s.riderId.toLowerCase().includes(q.toLowerCase())) &&
      (!status || s.status === status) &&
      (!direction || (direction === "pay" ? s.net >= 0 : s.net < 0)),
  );
  const owedToRiders = rows.filter((s) => s.net > 0).reduce((t, s) => t + s.net, 0);
  const owedByRiders = rows.filter((s) => s.net < 0).reduce((t, s) => t - s.net, 0);

  const columns: Column<SettlementView>[] = [
    {
      key: "rider",
      header: "Rider",
      cell: (s) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{s.riderName}</span>
          <span>{s.riderId}</span>
        </span>
      ),
    },
    {
      key: "trips",
      header: "Trips",
      align: "right",
      hideOnNarrow: true,
      cell: (s) => <span className={u.num}>{s.trips}</span>,
    },
    {
      key: "earn",
      header: "Earnings",
      align: "right",
      cell: (s) => <span className={u.num}>{formatRs(s.earnings)}</span>,
    },
    {
      key: "cash",
      header: "Cash held",
      align: "right",
      cell: (s) => <span className={u.num}>{formatRs(s.cashHeld)}</span>,
    },
    {
      key: "net",
      header: "Net",
      align: "right",
      cell: (s) =>
        s.net >= 0 ? (
          <span className={u.num}>Kadé pays {formatRs(s.net)}</span>
        ) : (
          <span className={cx(u.num, -s.net > 10000 && u.alertText)}>Rider owes {formatRs(-s.net)}</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (s) =>
        s.status === "settled" ? (
          <Status tone="done">Settled</Status>
        ) : (
          <button
            type="button"
            className={u.textButton}
            onClick={() => setConfirm(s)}
            aria-label={`Mark ${s.riderName} settled`}
          >
            Mark settled
          </button>
        ),
    },
  ];

  return (
    <>
      <Toolbar label="Filter settlements" count={`${rows.length} riders`}>
        <SearchField
          label="Search riders"
          placeholder="Rider name or id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "open", label: "Not settled" },
            { value: "settled", label: "Settled" },
            { value: "", label: "All" },
          ]}
        />
        <Select
          label="Direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          options={[
            { value: "", label: "Either way" },
            { value: "pay", label: "Kadé pays the rider" },
            { value: "owe", label: "Rider owes Kadé" },
          ]}
        />
      </Toolbar>
      <p className={cx(u.muted, styles.lede)}>
        Week of 28 Sep to 4 Oct. Earnings minus the cash riders collected. Kadé pays out{" "}
        <strong className={u.num}>{formatRs(owedToRiders)}</strong>; riders owe{" "}
        <strong className={u.num}>{formatRs(owedByRiders)}</strong>.
      </p>
      <DataTable
        caption="Rider settlements"
        columns={columns}
        rows={rows}
        rowKey={(s) => s.riderId}
        empty="No riders match these filters."
      />
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={`Mark ${confirm.riderName} settled?`}
          description={
            confirm.net >= 0
              ? `Confirms Kadé has paid ${formatRs(confirm.net)} to ${confirm.riderName}'s bank account.`
              : `Confirms ${confirm.riderName} has deposited the ${formatRs(-confirm.net)} they owed.`
          }
          confirmLabel="Mark settled"
          cancelLabel="Go back"
          onConfirm={() =>
            settle.mutate(confirm.riderId, {
              onSuccess: () =>
                toast({ title: "Settlement recorded", description: confirm.riderName, tone: "success" }),
            })
          }
        />
      )}
    </>
  );
}

/* ---------- Cash matching ---------- */

function DepositSheet({ record, onClose }: { record: CashView; onClose: () => void }) {
  const toast = useToast();
  const mutation = useRecordDeposit();
  const [amount, setAmount] = useState(String(record.collected));
  const [ref, setRef] = useState("");
  const value = Number(amount.replace(/[^\d]/g, "")) || 0;
  const diff = record.collected - value;

  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Record deposit from ${record.riderName}`}
      submitLabel="Mark deposit received"
      pending={mutation.isPending}
      validate={() => {
        if (value <= 0) return "Enter the amount on the deposit slip.";
        if (!/^[A-Za-z]{2,4}\s?\d{6,14}$/.test(ref.trim()))
          return "Enter the bank reference from the slip: the bank's letters then the number, like BOC2026100941.";
        return null;
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({ id: record.id, amount: value, bankRef: ref });
        toast({
          title: "Deposit recorded",
          description:
            diff === 0
              ? `${record.riderName}'s cash for ${formatDate(record.date)} matches.`
              : `Still ${formatRs(Math.abs(diff))} ${diff > 0 ? "short" : "over"}; flagged for follow-up.`,
          tone: diff === 0 ? "success" : "neutral",
        });
      }}
    >
      <p className={u.muted}>
        Cash collected on {formatDate(record.date)}:{" "}
        <strong className={u.num}>{formatRs(record.collected)}</strong>
      </p>
      <TextField
        label="Amount deposited"
        prefix="Rs"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        hint={
          value && diff !== 0
            ? `${formatRs(Math.abs(diff))} ${diff > 0 ? "less" : "more"} than collected. It will stay flagged.`
            : "Matches the cash collected."
        }
      />
      <TextField
        label="Bank reference"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        placeholder="BOC2026100941"
        autoComplete="off"
      />
    </ActionSheet>
  );
}

const cashStatus = (c: CashView) => {
  switch (c.state) {
    case "matched":
      return <Status tone="done">Matched</Status>;
    case "short":
      return <Status tone="alert">Short {formatRs(c.difference!)}</Status>;
    case "over":
      return <Status tone="progress">Over {formatRs(-c.difference!)}</Status>;
    case "awaiting":
      return <Status tone="progress">Waiting for deposit</Status>;
  }
};

function CashMatching({ rows: all }: { rows: CashView[] }) {
  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(true);
  const [recording, setRecording] = useState<CashView | null>(null);
  const dates = [...new Set(all.map((c) => c.date))];
  const rows = all.filter(
    (c) =>
      (!q || c.riderName.toLowerCase().includes(q.toLowerCase())) &&
      (!date || c.date === date) &&
      (!problemsOnly || c.state !== "matched"),
  );
  const short = all.filter((c) => c.state === "short").reduce((s, c) => s + c.difference!, 0);

  const columns: Column<CashView>[] = [
    {
      key: "rider",
      header: "Rider",
      cell: (c) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{c.riderName}</span>
          <span>{c.riderId}</span>
        </span>
      ),
    },
    { key: "date", header: "Day", cell: (c) => formatDate(c.date) },
    {
      key: "collected",
      header: "Collected",
      align: "right",
      cell: (c) => <span className={u.num}>{formatRs(c.collected)}</span>,
    },
    {
      key: "deposited",
      header: "Deposited",
      align: "right",
      cell: (c) => (
        <span className={cx(u.num, c.deposited === null && u.muted)}>
          {c.deposited === null ? "–" : formatRs(c.deposited)}
        </span>
      ),
    },
    { key: "status", header: "Match", cell: cashStatus },
    {
      key: "ref",
      header: "Bank reference",
      hideOnNarrow: true,
      cell: (c) => <span className={u.muted}>{c.bankRef ?? "–"}</span>,
    },
    {
      key: "act",
      header: <span className="kd-visually-hidden">Action</span>,
      cell: (c) =>
        c.state === "awaiting" ? (
          <button
            type="button"
            className={u.textButton}
            onClick={() => setRecording(c)}
            aria-label={`Record deposit from ${c.riderName} for ${formatDate(c.date)}`}
          >
            Record deposit
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <Toolbar label="Filter cash records" count={`${rows.length} records`}>
        <SearchField
          label="Search riders"
          placeholder="Rider name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Day"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          options={[
            { value: "", label: "All days" },
            ...dates.map((d) => ({ value: d, label: formatDate(d) })),
          ]}
        />
        <Switch
          checked={problemsOnly}
          onChange={setProblemsOnly}
          label="Only mismatches and missing deposits"
          className={styles.switchFilter}
        />
      </Toolbar>
      <p className={cx(u.muted, styles.lede)}>
        Cash riders collected on delivery against what reached Kadé's account.{" "}
        {short > 0 && (
          <>
            <strong className={u.alertText}>{formatRs(short)} missing</strong> across short deposits.
          </>
        )}
      </p>
      <DataTable
        caption="Cash collected against deposits"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        empty="Every deposit matches. Turn off the filter to see all records."
      />
      {recording && <DepositSheet record={recording} onClose={() => setRecording(null)} />}
    </>
  );
}

/* ---------- Refunds ledger ---------- */

function RefundsLedger({ rows: all }: { rows: RefundView[] }) {
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("");
  const rows = all.filter(
    (r) =>
      (!q ||
        r.orderId.toLowerCase().includes(q.toLowerCase()) ||
        r.customerName.toLowerCase().includes(q.toLowerCase())) &&
      (!method || r.method === method),
  );
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const columns: Column<RefundView>[] = [
    {
      key: "id",
      header: "Refund",
      cell: (r) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{r.id}</span>
          <span>{formatWhen(r.at)}</span>
        </span>
      ),
    },
    {
      key: "order",
      header: "Order",
      cell: (r) => (
        <Link href={`/orders?order=${r.orderId}&date=week`} className={u.textButton}>
          {r.orderId}
        </Link>
      ),
    },
    { key: "customer", header: "Customer", cell: (r) => r.customerName },
    { key: "reason", header: "Reason", hideOnNarrow: true, cell: (r) => r.reason },
    { key: "to", header: "To", cell: (r) => (r.method === "card" ? "Card" : "Kadé credit") },
    { key: "by", header: "By", hideOnNarrow: true, cell: (r) => <span className={u.muted}>{r.by}</span> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (r) => <span className={cx(u.num, u.strong)}>{formatRs(r.amount)}</span>,
    },
  ];

  return (
    <>
      <Toolbar label="Filter refunds" count={`${rows.length} refunds, ${formatRs(total)}`}>
        <SearchField
          label="Search refunds"
          placeholder="Order id or customer"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Refunded to"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          options={[
            { value: "", label: "Card or credit" },
            { value: "card", label: "Card" },
            { value: "credit", label: "Kadé credit" },
          ]}
        />
      </Toolbar>
      <DataTable
        caption="Refunds ledger, newest first"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty="No refunds match."
      />
    </>
  );
}

/* ---------- Page ---------- */

export function FinancePage() {
  useDocumentTitle("Finance");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "payouts";
  const payouts = usePayoutBatches();
  const settlements = useRiderSettlements();
  const cash = useCashRecords();
  const refunds = useRefunds();

  const counts = useMemo(
    () => ({
      payouts: payouts.data?.filter((b) => b.status === "draft").length,
      settlements: settlements.data?.filter((s) => s.status === "open").length,
      cash: cash.data?.filter((c) => c.state !== "matched").length,
    }),
    [payouts.data, settlements.data, cash.data],
  );

  const exportCsv = () => {
    const stamp = "2026-10-10";
    if (tab === "payouts" && payouts.data) {
      const b = payouts.data[0]!;
      downloadCsv(
        `kade-payouts-${b.id}.csv`,
        ["Restaurant", "Orders", "Gross", "Commission %", "Commission", "Refunds charged", "Payout", "Bank"],
        b.lines.map((l) => [
          l.restaurantName,
          l.orders,
          l.gross,
          l.commissionRate,
          l.commission,
          l.adjustments,
          l.net,
          l.bank,
        ]),
      );
    } else if (tab === "settlements" && settlements.data) {
      downloadCsv(
        `kade-rider-settlements-${stamp}.csv`,
        ["Rider id", "Rider", "Trips", "Earnings", "Cash held", "Net", "Status"],
        settlements.data.map((s) => [
          s.riderId,
          s.riderName,
          s.trips,
          s.earnings,
          s.cashHeld,
          s.net,
          s.status,
        ]),
      );
    } else if (tab === "cash" && cash.data) {
      downloadCsv(
        `kade-cash-matching-${stamp}.csv`,
        ["Rider id", "Rider", "Day", "Collected", "Deposited", "Difference", "Bank reference"],
        cash.data.map((c) => [
          c.riderId,
          c.riderName,
          c.date,
          c.collected,
          c.deposited ?? "",
          c.difference ?? "",
          c.bankRef ?? "",
        ]),
      );
    } else if (tab === "refunds" && refunds.data) {
      downloadCsv(
        `kade-refunds-${stamp}.csv`,
        ["Refund", "When", "Order", "Customer", "Reason", "To", "By", "Amount"],
        refunds.data.map((r) => [
          r.id,
          new Date(r.at).toISOString(),
          r.orderId,
          r.customerName,
          r.reason,
          r.method,
          r.by,
          r.amount,
        ]),
      );
    } else return;
    toast({ title: "CSV downloaded", description: "Check your downloads folder." });
  };

  const current = { payouts, settlements, cash, refunds }[tab];

  return (
    <>
      <PageHeader
        title="Finance"
        description="Weekly restaurant payouts after 18% commission, rider settlements and the cash riders carry."
        actions={
          <Button variant="secondary" icon="download" onClick={exportCsv} disabled={!current.data}>
            Export CSV
          </Button>
        }
      />
      <Tabs<Tab>
        label="Finance sections"
        value={tab}
        onChange={(t) => setParams(t === "payouts" ? {} : { tab: t }, { replace: true })}
        items={[
          { value: "payouts", label: "Restaurant payouts", count: counts.payouts || undefined },
          { value: "settlements", label: "Rider settlements", count: counts.settlements },
          { value: "cash", label: "Cash matching", count: counts.cash },
          { value: "refunds", label: "Refunds ledger" },
        ]}
      >
        <QueryState
          isLoading={current.isLoading}
          error={current.error}
          onRetry={() => void current.refetch()}
          what="finance records"
        />
        {tab === "payouts" && payouts.data && <Payouts batches={payouts.data} />}
        {tab === "settlements" && settlements.data && <Settlements rows={settlements.data} />}
        {tab === "cash" && cash.data && <CashMatching rows={cash.data} />}
        {tab === "refunds" && refunds.data && <RefundsLedger rows={refunds.data} />}
      </Tabs>
    </>
  );
}
