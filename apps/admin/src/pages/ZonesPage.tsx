import {
  Button,
  ConfirmDialog,
  DataTable,
  Select,
  Switch,
  TextField,
  cx,
  formatRs,
  useToast,
  type Column,
} from "@kade/ui";
import { useState, type ChangeEvent } from "react";
import { quoteDelivery, surchargeActive, type Pricing } from "@/api/pricing";
import {
  usePricing,
  useSaveSurcharge,
  useSetSurchargeEnabled,
  useSetWeather,
  useSetZoneOpen,
  useUpdateZoneFees,
} from "@/api/queries";
import type { SurchargeRule, Zone } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { ColomboMap } from "@/components/ColomboMap";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Status } from "@/components/Status";
import u from "@/components/ui.module.css";
import { formatClock } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./ZonesPage.module.css";

const num = (s: string) => Number(s.replace(/[^\d.]/g, ""));

/* ---------- Fee editor ---------- */

function FeesSheet({ zone, onClose }: { zone: Zone; onClose: () => void }) {
  const toast = useToast();
  const mutation = useUpdateZoneFees();
  const [f, setF] = useState({
    baseFee: String(zone.baseFee),
    perKm: String(zone.perKm),
    smallOrderFee: String(zone.smallOrderFee),
    smallOrderUnder: String(zone.smallOrderUnder),
  });
  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }),
  });
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delivery fees in ${zone.code}`}
      submitLabel="Save fees"
      pending={mutation.isPending}
      validate={() =>
        Object.values(f).some((v) => !v.trim() || Number.isNaN(num(v)))
          ? "Fill in every fee with a number of rupees."
          : null
      }
      onSubmit={async () => {
        await mutation.mutateAsync({
          id: zone.id,
          baseFee: num(f.baseFee),
          perKm: num(f.perKm),
          smallOrderFee: num(f.smallOrderFee),
          smallOrderUnder: num(f.smallOrderUnder),
        });
        toast({
          title: "Fees saved",
          description: `${zone.code}. New orders use them straight away.`,
          tone: "success",
        });
      }}
    >
      <p className={u.muted}>Orders already placed keep the fee they were quoted.</p>
      <div className={u.fieldPair}>
        <TextField
          label="Base fee"
          prefix="Rs"
          inputMode="numeric"
          hint="Covers the first 2 km"
          {...field("baseFee")}
        />
        <TextField label="Each km after that" prefix="Rs" inputMode="numeric" {...field("perKm")} />
      </div>
      <div className={u.fieldPair}>
        <TextField label="Small-order fee" prefix="Rs" inputMode="numeric" {...field("smallOrderFee")} />
        <TextField label="For orders under" prefix="Rs" inputMode="numeric" {...field("smallOrderUnder")} />
      </div>
    </ActionSheet>
  );
}

/* ---------- Surcharge rule editor ---------- */

const dayOptions: SurchargeRule["days"][] = ["Every day", "Mon to Fri", "Fri to Sun", "Sat and Sun"];

function SurchargeSheet({ rule, onClose }: { rule: SurchargeRule | null; onClose: () => void }) {
  const toast = useToast();
  const mutation = useSaveSurcharge();
  const [label, setLabel] = useState(rule?.label ?? "");
  const [days, setDays] = useState<SurchargeRule["days"]>(rule?.days ?? "Every day");
  const [start, setStart] = useState(rule?.start ?? "18:00");
  const [end, setEnd] = useState(rule?.end ?? "21:00");
  const [amount, setAmount] = useState(String(rule?.amount ?? 40));
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={rule ? `Edit ${rule.label.toLowerCase()}` : "Add a busy-time surcharge"}
      submitLabel={rule ? "Save rule" : "Add rule"}
      pending={mutation.isPending}
      validate={() => {
        if (!label.trim()) return "Name the rule, like “Dinner peak”.";
        if (start === end) return "Start and end can't be the same time.";
        if (!(num(amount) > 0)) return "Enter the surcharge in rupees.";
        return null;
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({
          id: rule?.id,
          label: label.trim(),
          days,
          start,
          end,
          amount: num(amount),
          enabled: rule?.enabled ?? true,
        });
        toast({
          title: rule ? "Rule saved" : "Rule added",
          description: `${label.trim()}: +${formatRs(num(amount))}`,
          tone: "success",
        });
      }}
    >
      <TextField
        label="Name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Dinner peak"
      />
      <Select
        label="Days"
        value={days}
        onChange={(e) => setDays(e.target.value as SurchargeRule["days"])}
        options={dayOptions.map((d) => ({ value: d, label: d }))}
      />
      <div className={u.fieldTrio}>
        <label>
          <span className={u.label}>From</span>
          <input type="time" className={u.input} value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span className={u.label}>Until</span>
          <input type="time" className={u.input} value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <TextField
          label="Adds"
          prefix="Rs"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <p className={cx(u.small, u.muted)}>
        Windows that cross midnight, like 23:00 to 02:00, run into the next morning.
      </p>
    </ActionSheet>
  );
}

/* ---------- Customer price preview ---------- */

function Preview({
  pricing,
  zoneId,
  onZone,
}: {
  pricing: Pricing;
  zoneId: string;
  onZone: (id: string) => void;
}) {
  const now = useNow(30_000);
  const [km, setKm] = useState("3.5");
  const [subtotal, setSubtotal] = useState("1450");
  const [when, setWhen] = useState("now");
  const at =
    when === "now"
      ? now
      : when === "lunch"
        ? new Date(2026, 9, 12, 12, 30).getTime()
        : when === "late"
          ? new Date(2026, 9, 10, 23, 30).getTime()
          : new Date(2026, 9, 13, 15, 0).getTime();
  const zone = pricing.zones.find((z) => z.id === zoneId)!;
  const q = quoteDelivery(pricing, zoneId, Number(km) || 0, num(subtotal) || 0, at);

  return (
    <section className={cx(u.surface, styles.preview)} aria-labelledby="preview-title">
      <h2 id="preview-title" className={u.sectionTitle}>
        What a customer pays
      </h2>
      <div className={styles.previewInputs}>
        <Select
          label="Delivering to"
          value={zoneId}
          onChange={(e) => onZone(e.target.value)}
          options={pricing.zones.map((z) => ({
            value: z.id,
            label: `${z.code}${z.code === z.name ? "" : `, ${z.name}`}`,
          }))}
        />
        <Select
          label="When"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          options={[
            { value: "now", label: `Now, ${formatClock(now)}` },
            { value: "lunch", label: "Monday, 12:30 pm" },
            { value: "quiet", label: "Tuesday, 3:00 pm" },
            { value: "late", label: "Saturday, 11:30 pm" },
          ]}
        />
        <TextField
          label="Distance"
          inputMode="decimal"
          value={km}
          onChange={(e) => setKm(e.target.value)}
          hint="km from the restaurant"
        />
        <TextField
          label="Food subtotal"
          prefix="Rs"
          inputMode="numeric"
          value={subtotal}
          onChange={(e) => setSubtotal(e.target.value)}
        />
      </div>
      {zone.open ? (
        <table className={styles.quote}>
          <caption className="kd-visually-hidden">Delivery fee breakdown</caption>
          <tbody>
            <tr>
              <th scope="row">Food</th>
              <td>{formatRs(num(subtotal) || 0)}</td>
            </tr>
            <tr>
              <th scope="row">Delivery, first 2 km</th>
              <td>{formatRs(q.base)}</td>
            </tr>
            {q.distance > 0 && (
              <tr>
                <th scope="row">
                  {Math.max(0, (Number(km) || 0) - 2).toFixed(1)} km more at {formatRs(zone.perKm)}
                </th>
                <td>{formatRs(q.distance)}</td>
              </tr>
            )}
            {q.smallOrder > 0 && (
              <tr>
                <th scope="row">Small order, under {formatRs(zone.smallOrderUnder)}</th>
                <td>{formatRs(q.smallOrder)}</td>
              </tr>
            )}
            {q.surcharges.map((s) => (
              <tr key={s.label}>
                <th scope="row">{s.label}</th>
                <td>{formatRs(s.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Delivery fee</th>
              <td>{formatRs(q.deliveryTotal)}</td>
            </tr>
            <tr className={styles.quoteTotal}>
              <th scope="row">Customer pays</th>
              <td>{formatRs(q.total)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className={u.alertText}>
          {zone.code} is closed, so customers there see “We don't deliver here yet”.
        </p>
      )}
    </section>
  );
}

/* ---------- Page ---------- */

export function ZonesPage() {
  useDocumentTitle("Zones and pricing");
  const toast = useToast();
  const now = useNow(30_000);
  const query = usePricing();
  const setOpen = useSetZoneOpen();
  const setEnabled = useSetSurchargeEnabled();
  const setWeather = useSetWeather();
  const [selected, setSelected] = useState("c03");
  const [editing, setEditing] = useState<Zone | null>(null);
  const [closing, setClosing] = useState<Zone | null>(null);
  const [rule, setRule] = useState<SurchargeRule | "new" | null>(null);
  const [rainAmount, setRainAmount] = useState<string | null>(null);
  const p = query.data;

  const toggleZone = (z: Zone, open: boolean) => {
    if (!open) return setClosing(z);
    setOpen.mutate(
      { id: z.id, open: true },
      {
        onSuccess: () =>
          toast({
            title: "Zone opened",
            description: `${z.code}. Customers there can order now.`,
            tone: "success",
          }),
      },
    );
  };

  const zoneColumns: Column<Zone>[] = [
    {
      key: "zone",
      header: "Zone",
      cell: (z) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{z.code}</span>
          {z.code !== z.name && <span>{z.name}</span>}
        </span>
      ),
    },
    {
      key: "open",
      header: "Taking orders",
      cell: (z) => (
        <Switch
          checked={z.open}
          onChange={(v) => toggleZone(z, v)}
          label={`${z.code} taking orders`}
          hideLabel
          disabled={setOpen.isPending}
        />
      ),
    },
    {
      key: "base",
      header: "Base fee",
      align: "right",
      cell: (z) => <span className={u.num}>{formatRs(z.baseFee)}</span>,
    },
    {
      key: "km",
      header: "Per km after 2",
      align: "right",
      cell: (z) => <span className={u.num}>{formatRs(z.perKm)}</span>,
    },
    {
      key: "small",
      header: "Small-order fee",
      align: "right",
      hideOnNarrow: true,
      cell: (z) => (
        <span className={u.num}>
          {formatRs(z.smallOrderFee)} <span className={u.muted}>under {formatRs(z.smallOrderUnder)}</span>
        </span>
      ),
    },
    {
      key: "edit",
      header: <span className="kd-visually-hidden">Edit</span>,
      cell: (z) => (
        <button
          type="button"
          className={u.textButton}
          onClick={() => setEditing(z)}
          aria-label={`Edit fees in ${z.code}`}
        >
          Edit fees
        </button>
      ),
    },
  ];

  const ruleColumns: Column<SurchargeRule>[] = [
    {
      key: "label",
      header: "Rule",
      cell: (r) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{r.label}</span>
          <span>{r.days}</span>
        </span>
      ),
    },
    {
      key: "time",
      header: "Time",
      cell: (r) => (
        <span className={u.num}>
          {r.start} to {r.end}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Adds",
      align: "right",
      cell: (r) => <span className={u.num}>{formatRs(r.amount)}</span>,
    },
    {
      key: "now",
      header: "Right now",
      hideOnNarrow: true,
      cell: (r) =>
        surchargeActive(r, now) ? (
          <Status tone="live">Charging</Status>
        ) : (
          <span className={u.muted}>{r.enabled ? "Not in window" : "Off"}</span>
        ),
    },
    {
      key: "on",
      header: "On",
      cell: (r) => (
        <Switch
          checked={r.enabled}
          hideLabel
          label={`${r.label} surcharge on`}
          onChange={(v) =>
            setEnabled.mutate(
              { id: r.id, enabled: v },
              {
                onSuccess: () =>
                  toast({ title: v ? "Surcharge turned on" : "Surcharge turned off", description: r.label }),
              },
            )
          }
        />
      ),
    },
    {
      key: "edit",
      header: <span className="kd-visually-hidden">Edit</span>,
      cell: (r) => (
        <button
          type="button"
          className={u.textButton}
          onClick={() => setRule(r)}
          aria-label={`Edit ${r.label}`}
        >
          Edit
        </button>
      ),
    },
  ];

  const closed = p?.zones.filter((z) => !z.open) ?? [];

  return (
    <>
      <PageHeader
        title="Zones and pricing"
        description={
          closed.length
            ? `${closed.map((z) => z.code).join(", ")} ${closed.length === 1 ? "is" : "are"} closed. Fee changes apply to new orders straight away.`
            : "Every zone is open. Fee changes apply to new orders straight away."
        }
      />
      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        what="zones and fees"
      />
      {p && (
        <div className={u.stack}>
          <div className={styles.top}>
            <section className={cx(u.surface, styles.mapPanel)} aria-labelledby="zones-map-title">
              <h2 id="zones-map-title" className={u.sectionTitle}>
                Delivery zones
              </h2>
              <ColomboMap
                label="Delivery zones with base fees. Choose a zone to preview what customers there pay."
                zones={p.zones}
                selectedId={selected}
                onSelect={setSelected}
                note={(id) => {
                  const z = p.zones.find((x) => x.id === id);
                  return z && formatRs(z.baseFee);
                }}
                describe={(id) => {
                  const z = p.zones.find((x) => x.id === id);
                  return z ? `base fee ${formatRs(z.baseFee)}, ${formatRs(z.perKm)} per km` : "";
                }}
              />
              <p className={cx(u.small, u.muted)}>
                Hatched zones are closed. Customers there can browse but can't order.
              </p>
            </section>

            <div className={u.stack}>
              <Preview pricing={p} zoneId={selected} onZone={setSelected} />
              <section
                className={cx(u.surface, u.surfacePad, styles.weather)}
                aria-labelledby="weather-title"
              >
                <h2 id="weather-title" className="kd-visually-hidden">
                  Weather surcharge
                </h2>
                <Switch
                  size="lg"
                  checked={p.weather.enabled}
                  onChange={(v) =>
                    setWeather.mutate(
                      { enabled: v, amount: p.weather.amount },
                      {
                        onSuccess: () =>
                          toast({
                            title: v ? "Heavy rain surcharge on" : "Heavy rain surcharge off",
                            description: v ? `+${formatRs(p.weather.amount)} on every delivery.` : undefined,
                            tone: "success",
                          }),
                      },
                    )
                  }
                  label={`Heavy rain: +${formatRs(p.weather.amount)}`}
                  description="Adds to every delivery in open zones and goes to riders. Turn it off when the rain stops."
                />
                <form
                  className={styles.rainForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (rainAmount === null) return;
                    setWeather.mutate(
                      { enabled: p.weather.enabled, amount: num(rainAmount) },
                      {
                        onSuccess: () => {
                          setRainAmount(null);
                          toast({
                            title: "Rain surcharge changed",
                            description: `+${formatRs(num(rainAmount))}`,
                            tone: "success",
                          });
                        },
                        onError: (err) =>
                          toast({ title: "Not saved", description: err.message, tone: "error" }),
                      },
                    );
                  }}
                >
                  <TextField
                    label="Rain surcharge"
                    prefix="Rs"
                    inputMode="numeric"
                    value={rainAmount ?? String(p.weather.amount)}
                    onChange={(e) => setRainAmount(e.target.value)}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    disabled={rainAmount === null || num(rainAmount) === p.weather.amount}
                  >
                    Save
                  </Button>
                </form>
              </section>
            </div>
          </div>

          <section aria-labelledby="fees-title" className={u.stackTight}>
            <h2 id="fees-title" className={u.sectionTitle}>
              Fees by zone
            </h2>
            <DataTable
              caption="Delivery fees by zone"
              columns={zoneColumns}
              rows={p.zones}
              rowKey={(z) => z.id}
              selectedKey={selected}
            />
          </section>

          <section aria-labelledby="rules-title" className={u.stackTight}>
            <div className={u.spread}>
              <h2 id="rules-title" className={u.sectionTitle}>
                Busy-time surcharges
              </h2>
              <Button size="sm" variant="secondary" icon="plus" onClick={() => setRule("new")}>
                Add rule
              </Button>
            </div>
            <DataTable
              caption="Busy-time surcharge rules"
              columns={ruleColumns}
              rows={p.surcharges}
              rowKey={(r) => r.id}
            />
          </section>
        </div>
      )}

      {editing && <FeesSheet zone={editing} onClose={() => setEditing(null)} />}
      {rule && <SurchargeSheet rule={rule === "new" ? null : rule} onClose={() => setRule(null)} />}
      {closing && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setClosing(null)}
          title={`Close ${closing.code}?`}
          description={`Customers in ${closing.name} can't place new orders until it reopens. Orders already placed are still delivered.`}
          confirmLabel="Close zone"
          cancelLabel="Keep open"
          onConfirm={() =>
            setOpen.mutate(
              { id: closing.id, open: false },
              {
                onSuccess: () => toast({ title: "Zone closed", description: closing.code, tone: "success" }),
              },
            )
          }
        />
      )}
    </>
  );
}
