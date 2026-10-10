import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  SegmentedControl,
  StatGroup,
  StatTile,
  Tag,
  formatRs,
  useToast,
} from "@kade/ui";
import { useState } from "react";
import { COMMISSION_RATE, addDays, mondayOf, statementCsv } from "@/api/payouts";
import { todayIso } from "@/api/promotions";
import { useSales, useStatements } from "@/api/queries";
import type { DailySales, Statement } from "@/api/types";
import { SalesChart } from "@/features/payouts/SalesChart";
import { downloadText } from "@/lib/download";
import { shortDate } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./PayoutsPage.module.css";

type Period = "thisWeek" | "lastWeek" | "30days";

function range(
  period: Period,
  today: string,
): { from: string; to: string; compareFrom: string; compareTo: string; label: string } {
  const monday = mondayOf(today);
  if (period === "thisWeek") {
    const days = Math.round((Date.parse(today) - Date.parse(monday)) / 86_400_000);
    return {
      from: monday,
      to: today,
      compareFrom: addDays(monday, -7),
      compareTo: addDays(monday, -7 + days),
      label: "the same days last week",
    };
  }
  if (period === "lastWeek")
    return {
      from: addDays(monday, -7),
      to: addDays(monday, -1),
      compareFrom: addDays(monday, -14),
      compareTo: addDays(monday, -8),
      label: "the week before",
    };
  return {
    from: addDays(today, -29),
    to: today,
    compareFrom: addDays(today, -59),
    compareTo: addDays(today, -30),
    label: "the 30 days before",
  };
}

function totals(days: DailySales[] | undefined) {
  const d = days ?? [];
  const card = d.reduce((s, x) => s + x.card, 0);
  const cash = d.reduce((s, x) => s + x.cash, 0);
  const gross = card + cash;
  const commission = Math.round(gross * COMMISSION_RATE);
  const offerCost = d.reduce((s, x) => s + x.offerCost, 0);
  return {
    card,
    cash,
    gross,
    commission,
    offerCost,
    net: gross - commission - offerCost,
    orders: d.reduce((s, x) => s + x.orders, 0),
  };
}

const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n * 100))}%`;

export function PayoutsPage() {
  useDocumentTitle("Sales and payouts");
  const today = todayIso();
  const [period, setPeriod] = useState<Period>("thisWeek");
  const r = range(period, today);
  const sales = useSales(r.from, r.to);
  const before = useSales(r.compareFrom, r.compareTo);
  const now = totals(sales.data);
  const prev = totals(before.data);
  const change = prev.gross ? now.gross / prev.gross - 1 : 0;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Sales and payouts</h1>
          <p className={styles.muted}>
            Paid every Tuesday to Commercial Bank, account ending 4471, for the Monday to Sunday before.
          </p>
        </div>
        <SegmentedControl
          label="Period"
          value={period}
          onChange={setPeriod}
          className={styles.period}
          options={[
            { value: "thisWeek", label: "This week" },
            { value: "lastWeek", label: "Last week" },
            { value: "30days", label: "Last 30 days" },
          ]}
        />
      </header>

      {sales.isError ? (
        <EmptyState
          title="Sales didn't load"
          description="Check the tablet's connection and try again."
          action={<Button onClick={() => void sales.refetch()}>Try again</Button>}
        />
      ) : (
        <>
          <section
            aria-label={`Totals from ${shortDate(r.from)} to ${shortDate(r.to)}`}
            aria-busy={sales.isPending}
          >
            <StatGroup className={styles.stats}>
              <StatTile
                label="Gross sales"
                value={sales.isPending ? "…" : formatRs(now.gross)}
                change={before.data ? `${pct(change)} on ${r.label}` : undefined}
                tone={change >= 0 ? "good" : "bad"}
              />
              <StatTile
                label={`Kadé commission, ${COMMISSION_RATE * 100}%`}
                value={sales.isPending ? "…" : formatRs(now.commission)}
                change={`On ${now.orders} orders`}
              />
              <StatTile
                label="Card and cash"
                value={
                  sales.isPending || !now.gross ? "…" : `${Math.round((now.card / now.gross) * 100)}% card`
                }
                change={`${formatRs(now.card)} card, ${formatRs(now.cash)} cash`}
              />
              <StatTile
                label="Net payout"
                value={sales.isPending ? "…" : formatRs(now.net)}
                change={`After commission and ${formatRs(now.offerCost)} of offers`}
              />
            </StatGroup>
          </section>

          <Panel title="Daily sales" titleId="daily-title" className={styles.panel}>
            {sales.data ? <SalesChart days={sales.data} /> : <p className={styles.muted}>Loading…</p>}
          </Panel>
        </>
      )}

      <Statements />
    </div>
  );
}

function Statements() {
  const toast = useToast();
  const { data, isPending, isError, refetch } = useStatements();
  const download = (s: Statement) => {
    downloadText(`kade-statement-${s.from}.csv`, statementCsv(s));
    toast({ title: "Statement downloaded", description: `Week of ${shortDate(s.from)}` });
  };

  return (
    <Panel title="Weekly statements" titleId="statements-title" className={styles.panel}>
      {isPending && <p className={styles.muted}>Loading statements…</p>}
      {isError && (
        <EmptyState
          title="Statements didn't load"
          action={<Button onClick={() => void refetch()}>Try again</Button>}
        />
      )}
      {data && (
        <DataTable
          caption="Weekly payout statements"
          rows={data}
          rowKey={(s) => s.id}
          columns={[
            {
              key: "week",
              header: "Week",
              cell: (s) => (
                <span className={styles.week}>
                  {shortDate(s.from)} to {shortDate(s.to)}
                </span>
              ),
            },
            { key: "orders", header: "Orders", cell: (s) => s.orders, align: "right", hideOnNarrow: true },
            {
              key: "gross",
              header: "Gross sales",
              cell: (s) => formatRs(s.gross),
              align: "right",
              hideOnNarrow: true,
            },
            {
              key: "commission",
              header: "Commission",
              cell: (s) => `−${formatRs(s.commission)}`,
              align: "right",
              hideOnNarrow: true,
            },
            {
              key: "offers",
              header: "Offers",
              cell: (s) => `−${formatRs(s.offerCost)}`,
              align: "right",
              hideOnNarrow: true,
            },
            {
              key: "net",
              header: "Net payout",
              cell: (s) => <strong>{formatRs(s.net)}</strong>,
              align: "right",
            },
            {
              key: "status",
              header: "Status",
              cell: (s) =>
                s.status === "paid" ? (
                  <Tag tone="positive">Paid {shortDate(s.payDate)}</Tag>
                ) : (
                  <Tag tone="warning">
                    {s.to >= todayIso() ? "Adding up, pays" : "Pays"} {shortDate(s.payDate)}
                  </Tag>
                ),
            },
            {
              key: "csv",
              header: <span className="kd-visually-hidden">Download</span>,
              cell: (s) => (
                <Button
                  variant="outline"
                  size="sm"
                  icon="download"
                  onClick={() => download(s)}
                  aria-label={`Download statement for the week of ${shortDate(s.from)} as CSV`}
                >
                  CSV
                </Button>
              ),
              align: "right",
            },
          ]}
        />
      )}
    </Panel>
  );
}
