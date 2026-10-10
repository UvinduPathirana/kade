import { Button, Icon, StatGroup, StatTile, Tabs, Tag, cx, formatRs, plural, useToast } from "@kade/ui";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { depositPoints } from "@/api/payouts";
import { useCashBalance, useEarnings, usePayouts, useProfile, useQuests } from "@/api/queries";
import { cashHolding, type Period } from "@/api/types";
import { EarningsChart } from "@/features/earnings/EarningsChart";
import c from "@/layout/common.module.css";
import { clockTime, duration, shortDate } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./EarningsPage.module.css";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

export function EarningsPage() {
  useDocumentTitle("Earnings");
  const [period, setPeriod] = useState<Period>("today");
  return (
    <div className={c.page}>
      <h1 className={c.heading}>Earnings</h1>
      <Tabs items={PERIODS} value={period} onChange={setPeriod} label="Earnings period">
        <PeriodSummary period={period} />
      </Tabs>
      <Quests />
      <CashHeld />
      <Payouts />
    </div>
  );
}

function PeriodSummary({ period }: { period: Period }) {
  const { data, isPending, isError } = useEarnings(period);
  if (isPending) return <p className={c.muted}>Loading earnings…</p>;
  if (isError || !data) return <p className={c.error}>Couldn't load earnings. Try again in a moment.</p>;
  const chartTitle = period === "today" ? "Earnings by hour today" : "Earnings by day";
  return (
    <div className={styles.summary}>
      <StatGroup className={styles.stats}>
        <StatTile
          label="Earnings"
          value={formatRs(data.total)}
          change={data.comparison?.text}
          tone={data.comparison?.tone}
        />
        <StatTile label="Trips" value={data.trips} />
        <StatTile label="Online" value={duration(data.onlineMinutes)} />
        <StatTile label="Tips" value={formatRs(data.tips)} />
      </StatGroup>
      <EarningsChart key={period} bars={data.bars} title={chartTitle} />
    </div>
  );
}

function Progress({ done, target, label }: { done: number; target: number; label: string }) {
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={done}
      aria-valuetext={`${done} of ${target}`}
    >
      <span style={{ width: `${Math.min(100, (done / target) * 100)}%` }} />
    </div>
  );
}

function Quests() {
  const { data } = useQuests();
  const now = useNow(60_000);
  return (
    <section className={c.section} aria-labelledby="quests-title">
      <h2 id="quests-title" className={c.sectionTitle}>
        Bonuses
      </h2>
      <ul className={styles.quests}>
        {data?.map((q) => {
          const complete = q.done >= q.target;
          return (
            <li key={q.id} className={styles.quest}>
              <div className={styles.questHead}>
                <strong>{q.title}</strong>
                <span className={c.amount}>{formatRs(q.bonus)}</span>
              </div>
              <p className={c.muted}>{q.detail}</p>
              <Progress done={q.done} target={q.target} label={q.title} />
              <p className={styles.questMeta}>
                {complete ? (
                  <Tag tone="positive" icon="check">
                    Bonus earned
                  </Tag>
                ) : (
                  <>
                    {q.done} of {q.target} trips. Ends{" "}
                    {q.endsAt - now < 86_400_000 ? `at ${clockTime(q.endsAt)}` : shortDate(q.endsAt)}
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CashHeld() {
  const { data: cash } = useCashBalance();
  const { data: profile } = useProfile();
  const { hash } = useLocation();
  const toast = useToast();

  useEffect(() => {
    if (hash === "#cash" && cash) document.getElementById("cash")?.scrollIntoView({ block: "start" });
  }, [hash, cash]);

  if (!cash) return null;
  const holding = cashHolding(cash);
  const over = holding >= cash.limit;
  const near = !over && holding >= cash.limit * 0.8;
  const reference = profile?.depositReference ?? "";

  return (
    <section id="cash" className={c.section} aria-labelledby="cash-title">
      <h2 id="cash-title" className={c.sectionTitle}>
        Cash you're holding
      </h2>
      <div className={cx(styles.cashCard, over && c.danger, near && c.warn)}>
        <p className={styles.cashFigure}>{formatRs(holding)}</p>
        <dl className={styles.cashMath}>
          <div>
            <dt>Cash collected from customers</dt>
            <dd>{formatRs(cash.collected)}</dd>
          </div>
          <div>
            <dt>Less what Kadé owes you</dt>
            <dd>−{formatRs(cash.owedToRider)}</dd>
          </div>
        </dl>
        <Progress
          done={Math.min(holding, cash.limit)}
          target={cash.limit}
          label="Cash held against your limit"
        />
        <p className={styles.limitLine}>
          {over ? (
            <>
              <Icon name="alert" size={18} /> Over your {formatRs(cash.limit)} limit. You'll get card orders
              only until you deposit.
            </>
          ) : (
            `${formatRs(cash.limit - holding)} left before your ${formatRs(cash.limit)} limit.`
          )}
        </p>
        <p className={c.muted}>Last deposit {shortDate(cash.lastDepositAt)}.</p>
      </div>

      <h3 className={styles.subTitle}>How to deposit</h3>
      <ol className={styles.steps}>
        <li>Deposit {formatRs(holding)} at a deposit point or into Kadé's bank account.</li>
        <li>
          Use your reference <strong className={styles.reference}>{reference}</strong> so we can match it.
          <Button
            variant="outline"
            size="sm"
            icon="doc"
            className={styles.copy}
            onClick={() =>
              void navigator.clipboard
                ?.writeText(reference)
                .then(() => toast({ title: "Reference copied", tone: "success" }))
            }
          >
            Copy reference
          </Button>
        </li>
        <li>Your balance updates within an hour. Bank deposits can take until the next working day.</li>
      </ol>
      <ul className={c.list}>
        {depositPoints.map((d) => (
          <li key={d.name} className={styles.point}>
            <strong>{d.name}</strong>
            <span>{d.where}</span>
            <span className={c.muted}>{d.hours}</span>
          </li>
        ))}
        <li className={styles.point}>
          <strong>Bank deposit</strong>
          <span>Commercial Bank, Kadé (Pvt) Ltd, account 1000 4521 77</span>
          <span className={c.muted}>Write {reference} as the reference</span>
        </li>
      </ul>
    </section>
  );
}

function Payouts() {
  const { data } = usePayouts();
  const { data: profile } = useProfile();
  return (
    <section className={c.section} aria-labelledby="payouts-title">
      <h2 id="payouts-title" className={c.sectionTitle}>
        Payouts
      </h2>
      <p className={c.muted}>
        Paid every Tuesday to{" "}
        {profile ? `${profile.bank.name}, account ending ${profile.bank.last4}` : "your bank"}.
      </p>
      <ul className={c.list}>
        {data?.map((p) => (
          <li key={p.id} className={c.listRow}>
            <span className={styles.payoutText}>
              <strong>{p.status === "scheduled" ? "This week's pay" : `Week of ${p.weekOf}`}</strong>
              <span className={c.muted}>
                {p.status === "scheduled" ? `Pays on ${shortDate(p.paidAt)}` : `Paid ${shortDate(p.paidAt)}`}
                {p.cashOffset > 0 && `. ${formatRs(p.cashOffset)} kept for cash you held`}
              </span>
            </span>
            {p.status === "scheduled" ? (
              <Tag tone="neutral">Scheduled</Tag>
            ) : (
              <span className={c.amount}>{formatRs(p.amount)}</span>
            )}
          </li>
        ))}
      </ul>
      <p className={c.muted}>{data ? plural(data.length - 1, "payout") : ""} in the last month.</p>
    </section>
  );
}
