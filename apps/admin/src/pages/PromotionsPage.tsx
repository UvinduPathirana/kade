import {
  Button,
  Choice,
  ConfirmDialog,
  DataTable,
  Drawer,
  SearchField,
  Select,
  TextField,
  cx,
  formatRs,
  useToast,
  type Column,
} from "@kade/ui";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useCreateVoucher, useRestaurants, useSetVoucherStatus, useVouchers } from "@/api/queries";
import type { Voucher, VoucherStatus, VoucherType } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { DetailList, DrawerSection } from "@/components/DetailList";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Status } from "@/components/Status";
import { Toolbar } from "@/components/Toolbar";
import u from "@/components/ui.module.css";
import { formatDate } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./PromotionsPage.module.css";

const statusTag = (s: VoucherStatus) =>
  s === "active" ? (
    <Status tone="live">Active</Status>
  ) : s === "scheduled" ? (
    <Status tone="progress">Scheduled</Status>
  ) : s === "paused" ? (
    <Status tone="stopped">Paused</Status>
  ) : (
    <Status tone="done">Ended</Status>
  );

function Meter({
  value,
  max,
  label,
  warnAt = 0.9,
}: {
  value: number;
  max: number;
  label: string;
  warnAt?: number;
}) {
  const ratio = max ? Math.min(1, value / max) : 0;
  return (
    <span className={styles.meter}>
      <span className={cx(u.num, ratio >= warnAt && u.alertText)}>{label}</span>
      <span className={styles.track} aria-hidden="true">
        <span
          className={cx(styles.fill, ratio >= warnAt && styles.fillAlert)}
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
    </span>
  );
}

/* ---------- Create voucher ---------- */

function CreateVoucherSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const mutation = useCreateVoucher();
  const restaurants = useRestaurants();
  const [code, setCode] = useState("");
  const [type, setType] = useState<VoucherType>("fixed");
  const [value, setValue] = useState("200");
  const [maxDiscount, setMaxDiscount] = useState("500");
  const [minOrder, setMinOrder] = useState("1500");
  const [scope, setScope] = useState<"all" | "some">("all");
  const [ids, setIds] = useState<number[]>([]);
  const [newOnly, setNewOnly] = useState(false);
  const [startsOn, setStartsOn] = useState("2026-10-12");
  const [endsOn, setEndsOn] = useState("2026-10-31");
  const [limit, setLimit] = useState("1000");
  const [budget, setBudget] = useState("200000");
  const n = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

  const offer =
    type === "fixed"
      ? `${formatRs(n(value))} off`
      : type === "percent"
        ? `${n(value)}% off, up to ${formatRs(n(maxDiscount))}`
        : "Free delivery";
  const where =
    scope === "all"
      ? ""
      : ` at ${ids
          .map((id) => restaurants.data?.find((r) => r.id === id)?.name)
          .filter(Boolean)
          .join(", ")}`;
  const description = `${offer}${n(minOrder) ? ` on orders of ${formatRs(n(minOrder))} or more` : ""}${where}${newOnly ? ", first order only" : ""}`;

  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create voucher"
      submitLabel="Create voucher"
      pending={mutation.isPending}
      validate={() => {
        if (!/^[A-Za-z0-9]{4,16}$/.test(code.trim()))
          return "Codes are 4 to 16 letters and numbers, with no spaces.";
        if (type === "fixed" && !(n(value) > 0)) return "Enter how many rupees off.";
        if (type === "percent" && !(n(value) > 0 && n(value) <= 50))
          return "Percent off must be between 1 and 50.";
        if (type === "fixed" && n(minOrder) && n(value) >= n(minOrder))
          return "The discount must be less than the minimum order.";
        if (scope === "some" && ids.length === 0)
          return "Choose at least one restaurant, or make it work everywhere.";
        if (!startsOn || !endsOn || endsOn < startsOn)
          return "The end date must be on or after the start date.";
        if (!(n(budget) > 0) || !(n(limit) > 0)) return "Set a budget and a limit on uses.";
        return null;
      }}
      onSubmit={async () => {
        const v = await mutation.mutateAsync({
          code,
          description,
          type,
          value: type === "freeDelivery" ? 0 : n(value),
          maxDiscount: type === "percent" ? n(maxDiscount) : undefined,
          minOrder: n(minOrder),
          restaurantIds: scope === "all" ? [] : ids,
          newCustomersOnly: newOnly,
          startsOn,
          endsOn,
          limit: n(limit),
          budget: n(budget),
        });
        toast({
          title: "Voucher created",
          description: `${v.code}: ${v.status === "scheduled" ? `starts ${formatDate(v.startsOn)}` : "live now"}.`,
          tone: "success",
        });
      }}
    >
      <TextField
        label="Code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))}
        placeholder="KOTTUFRIDAY"
        hint="What customers type at checkout."
        autoComplete="off"
      />
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>Discount</legend>
        <Choice
          type="radio"
          name="vtype"
          checked={type === "fixed"}
          onChange={() => setType("fixed")}
          label="Rupees off"
        />
        <Choice
          type="radio"
          name="vtype"
          checked={type === "percent"}
          onChange={() => setType("percent")}
          label="Percent off"
        />
        <Choice
          type="radio"
          name="vtype"
          checked={type === "freeDelivery"}
          onChange={() => setType("freeDelivery")}
          label="Free delivery"
        />
      </fieldset>
      <div className={u.fieldPair}>
        {type !== "freeDelivery" && (
          <TextField
            label={type === "fixed" ? "Amount off" : "Percent off, 1 to 50"}
            prefix={type === "fixed" ? "Rs" : undefined}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        {type === "percent" && (
          <TextField
            label="Most it can take off"
            prefix="Rs"
            inputMode="numeric"
            value={maxDiscount}
            onChange={(e) => setMaxDiscount(e.target.value)}
          />
        )}
        <TextField
          label="Minimum order"
          prefix="Rs"
          inputMode="numeric"
          value={minOrder}
          onChange={(e) => setMinOrder(e.target.value)}
          hint="Food subtotal. 0 for none."
        />
      </div>
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>Restaurants</legend>
        <Choice
          type="radio"
          name="scope"
          checked={scope === "all"}
          onChange={() => setScope("all")}
          label="Every restaurant"
        />
        <Choice
          type="radio"
          name="scope"
          checked={scope === "some"}
          onChange={() => setScope("some")}
          label="Only the ones I choose"
        />
        {scope === "some" && (
          <div className={cx(u.checkGrid, styles.restaurants)}>
            {(restaurants.data ?? []).map((r) => (
              <label key={r.id} className={u.check}>
                <input
                  type="checkbox"
                  checked={ids.includes(r.id)}
                  onChange={(e) => setIds(e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id))}
                />
                {r.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <label className={u.check}>
        <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
        New customers only (first order on Kadé)
      </label>
      <div className={u.fieldPair}>
        <label>
          <span className={u.label}>Starts</span>
          <input
            type="date"
            className={u.input}
            value={startsOn}
            min="2026-10-10"
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </label>
        <label>
          <span className={u.label}>Ends</span>
          <input
            type="date"
            className={u.input}
            value={endsOn}
            min={startsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </label>
      </div>
      <div className={u.fieldPair}>
        <TextField
          label="Total uses allowed"
          inputMode="numeric"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
        <TextField
          label="Budget"
          prefix="Rs"
          inputMode="numeric"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          hint="The code stops working when this is spent."
        />
      </div>
      <p className={styles.previewLine}>
        Customers see: <strong>{description}.</strong>
      </p>
    </ActionSheet>
  );
}

/* ---------- Voucher detail ---------- */

function VoucherDrawer({ v, onClose }: { v: Voucher | undefined; onClose: () => void }) {
  const toast = useToast();
  const restaurants = useRestaurants();
  const mutation = useSetVoucherStatus();
  const [ending, setEnding] = useState(false);
  const set = (status: VoucherStatus, title: string) =>
    v &&
    mutation.mutate(
      { code: v.code, status },
      {
        onSuccess: () => toast({ title, description: v.code, tone: "success" }),
        onError: (e) => toast({ title: "Not changed", description: e.message, tone: "error" }),
      },
    );

  return (
    <Drawer
      open={!!v}
      onOpenChange={(o) => !o && onClose()}
      title={v?.code ?? "Voucher"}
      closeLabel="Close voucher"
      footer={
        v &&
        v.status !== "ended" && (
          <div className={u.row}>
            {v.status === "paused" ? (
              <Button size="sm" icon="play" onClick={() => set("active", "Voucher resumed")}>
                Resume
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon="pause"
                onClick={() => set("paused", "Voucher paused")}
              >
                Pause
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEnding(true)}>
              End voucher
            </Button>
          </div>
        )
      }
    >
      {v && (
        <div className={u.stack}>
          <div className={styles.summary}>
            {statusTag(v.status)}
            <p>{v.description}.</p>
          </div>
          <DrawerSection title="Usage">
            <div className={u.stackTight}>
              <Meter
                value={v.uses}
                max={v.limit}
                label={`${v.uses.toLocaleString("en-LK")} of ${v.limit.toLocaleString("en-LK")} uses`}
              />
              <Meter
                value={v.spent}
                max={v.budget}
                label={`${formatRs(v.spent)} of ${formatRs(v.budget)} budget spent`}
              />
              {v.uses > 0 && (
                <p className={cx(u.small, u.muted)}>
                  Average discount {formatRs(v.spent / v.uses)} per order.
                </p>
              )}
            </div>
          </DrawerSection>
          <DrawerSection title="Rules">
            <DetailList
              items={[
                ["Minimum order", v.minOrder ? formatRs(v.minOrder) : "None"],
                ["Most off", v.maxDiscount ? formatRs(v.maxDiscount) : undefined],
                [
                  "Restaurants",
                  v.restaurantIds.length
                    ? v.restaurantIds
                        .map((id) => restaurants.data?.find((r) => r.id === id)?.name ?? `#${id}`)
                        .join(", ")
                    : "Every restaurant",
                ],
                ["Who", v.newCustomersOnly ? "New customers, first order" : "Everyone"],
                ["Runs", `${formatDate(v.startsOn)} to ${formatDate(v.endsOn)}`],
              ]}
            />
          </DrawerSection>
          <ConfirmDialog
            open={ending}
            onOpenChange={setEnding}
            title={`End ${v.code}?`}
            description="Customers who type it see “This code has ended”. You can't restart an ended code; create a new one instead."
            confirmLabel="End voucher"
            cancelLabel="Go back"
            onConfirm={() => set("ended", "Voucher ended")}
          />
        </div>
      )}
    </Drawer>
  );
}

/* ---------- Page ---------- */

export function PromotionsPage() {
  useDocumentTitle("Promotions");
  const [params, setParams] = useSearchParams();
  const query = useVouchers();
  const restaurants = useRestaurants();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const openCode = params.get("code");

  const rows = (query.data ?? []).filter(
    (v) =>
      (!q || v.code.includes(q.toUpperCase()) || v.description.toLowerCase().includes(q.toLowerCase())) &&
      (!status || v.status === status),
  );
  const live = query.data?.filter((v) => v.status === "active") ?? [];
  const spentLive = live.reduce((s, v) => s + v.spent, 0);
  const nearlyOut = live.filter((v) => v.spent / v.budget >= 0.9).length;

  const columns: Column<Voucher>[] = [
    {
      key: "code",
      header: "Code",
      cell: (v) => (
        <span className={u.cellStack}>
          <span className={styles.code}>{v.code}</span>
          <span>{v.newCustomersOnly ? "New customers" : "Everyone"}</span>
        </span>
      ),
    },
    { key: "offer", header: "Offer", cell: (v) => <span className={styles.offer}>{v.description}</span> },
    { key: "status", header: "Status", cell: (v) => statusTag(v.status) },
    {
      key: "uses",
      header: "Uses",
      hideOnNarrow: true,
      cell: (v) => (
        <Meter
          value={v.uses}
          max={v.limit}
          warnAt={2}
          label={`${v.uses.toLocaleString("en-LK")} / ${v.limit.toLocaleString("en-LK")}`}
        />
      ),
    },
    {
      key: "budget",
      header: "Budget spent",
      cell: (v) => (
        <Meter
          value={v.spent}
          max={v.budget}
          warnAt={v.status === "active" ? 0.9 : 2}
          label={`${formatRs(v.spent)} of ${formatRs(v.budget)}`}
        />
      ),
    },
    {
      key: "where",
      header: "Restaurants",
      hideOnNarrow: true,
      cell: (v) =>
        v.restaurantIds.length ? (
          v.restaurantIds.map((id) => restaurants.data?.find((r) => r.id === id)?.name).join(", ")
        ) : (
          <span className={u.muted}>All</span>
        ),
    },
    {
      key: "dates",
      header: "Runs",
      hideOnNarrow: true,
      cell: (v) => (
        <span className={u.num}>
          {formatDate(v.startsOn)} to {formatDate(v.endsOn)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Promotions and vouchers"
        description={`${live.length} codes live, ${formatRs(spentLive)} spent so far.${nearlyOut ? ` ${nearlyOut} close to their budget.` : ""}`}
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            Create voucher
          </Button>
        }
      />
      <Toolbar label="Filter vouchers" count={query.data ? `${rows.length} vouchers` : undefined}>
        <SearchField
          label="Search vouchers"
          placeholder="Code or offer"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "", label: "Any status" },
            { value: "active", label: "Active" },
            { value: "scheduled", label: "Scheduled" },
            { value: "paused", label: "Paused" },
            { value: "ended", label: "Ended" },
          ]}
        />
      </Toolbar>
      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        what="vouchers"
      />
      {query.data && (
        <DataTable
          caption="Vouchers. Choose a row to pause, resume or end a code."
          columns={columns}
          rows={rows}
          rowKey={(v) => v.code}
          onRowClick={(v) => setParams({ code: v.code }, { replace: true })}
          selectedKey={openCode ?? undefined}
          empty="No vouchers match."
        />
      )}
      {creating && <CreateVoucherSheet onClose={() => setCreating(false)} />}
      <VoucherDrawer
        v={query.data?.find((v) => v.code === openCode)}
        onClose={() => setParams({}, { replace: true })}
      />
    </>
  );
}
