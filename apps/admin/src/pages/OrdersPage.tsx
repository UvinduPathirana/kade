import { DataTable, SearchField, Select, formatRs, type Column } from "@kade/ui";
import { useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { DAY, TODAY_START } from "@/api/client";
import type { OrderView } from "@/api/orders";
import { useOrders, useZones } from "@/api/queries";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { ShowMore } from "@/components/ShowMore";
import { Toolbar } from "@/components/Toolbar";
import u from "@/components/ui.module.css";
import { OrderDrawer } from "@/features/orders/OrderDrawer";
import { isFinalStatus } from "@/features/orders/orderHelpers";
import { OrderStatusTag } from "@/features/orders/orderStatus";
import { formatClock, formatWhen } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useSlashFocus } from "@/lib/useSlashFocus";

const statusOptions = [
  { value: "", label: "Any status" },
  { value: "active", label: "In progress" },
  { value: "late", label: "Late" },
  { value: "unassigned", label: "No rider yet" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled or rejected" },
  { value: "refunded", label: "Refunded" },
];

const dateOptions = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "Last 7 days" },
];

const PAGE = 50;

function matchesStatus(o: OrderView, status: string) {
  switch (status) {
    case "active":
      return !isFinalStatus(o.status);
    case "late":
      return o.lateMin > 0;
    case "unassigned":
      return !isFinalStatus(o.status) && !o.rider;
    case "delivered":
      return o.status === "delivered";
    case "cancelled":
      return o.status === "cancelled" || o.status === "rejected";
    case "refunded":
      return o.refunded > 0;
    default:
      return true;
  }
}

export function OrdersPage() {
  useDocumentTitle("Orders");
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const incoming = (location.state as { q?: string } | null)?.q;
  const [q, setQ] = useState<string>(incoming ?? "");
  // A new search from the top bar while this page is open replaces the search text
  const [seenKey, setSeenKey] = useState(location.key);
  if (seenKey !== location.key) {
    setSeenKey(location.key);
    if (incoming !== undefined) setQ(incoming);
  }
  const [shown, setShown] = useState(PAGE);
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchRef);

  const query = useOrders();
  const zones = useZones();
  const status = params.get("status") ?? "";
  const zone = params.get("zone") ?? "";
  const payment = params.get("payment") ?? "";
  const date = params.get("date") ?? "today";
  const openId = params.get("order");

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: key !== "order" });
    if (key !== "order") setShown(PAGE);
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const from =
      date === "today" ? TODAY_START : date === "yesterday" ? TODAY_START - DAY : TODAY_START - 6 * DAY;
    const to = date === "yesterday" ? TODAY_START : Infinity;
    return (query.data ?? []).filter(
      (o) =>
        o.placedAt >= from &&
        o.placedAt < to &&
        matchesStatus(o, status) &&
        (!zone || o.zoneId === zone) &&
        (!payment || o.payment === payment) &&
        (!needle ||
          o.id.toLowerCase().includes(needle) ||
          o.customer.name.toLowerCase().includes(needle) ||
          o.customer.phone.replaceAll(" ", "").includes(needle.replaceAll(" ", "")) ||
          o.restaurant.name.toLowerCase().includes(needle) ||
          (o.rider?.name.toLowerCase().includes(needle) ?? false) ||
          o.rider?.id.toLowerCase() === needle),
    );
  }, [query.data, q, status, zone, payment, date]);

  // Late orders float to the top while looking at live work
  const sorted =
    status === "active" || status === "late" ? [...rows].sort((a, b) => b.lateMin - a.lateMin) : rows;

  const columns: Column<OrderView>[] = [
    {
      key: "id",
      header: "Order",
      cell: (o) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{o.id}</span>
          <span className={u.num}>{date === "today" ? formatClock(o.placedAt) : formatWhen(o.placedAt)}</span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (o) => <OrderStatusTag order={o} /> },
    {
      key: "restaurant",
      header: "Restaurant",
      cell: (o) => (
        <span className={u.cellStack}>
          <span>{o.restaurant.name}</span>
          <span>{o.restaurant.area}</span>
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      hideOnNarrow: true,
      cell: (o) => (
        <span className={u.cellStack}>
          <span>{o.customer.name}</span>
          <span>{o.zone.code}</span>
        </span>
      ),
    },
    {
      key: "rider",
      header: "Rider",
      hideOnNarrow: true,
      cell: (o) =>
        o.rider ? (
          o.rider.name
        ) : isFinalStatus(o.status) ? (
          <span className={u.muted}>None</span>
        ) : (
          <span className={o.status === "ready" ? u.alertText : u.muted}>Not assigned</span>
        ),
    },
    {
      key: "payment",
      header: "Paid by",
      hideOnNarrow: true,
      cell: (o) => (o.payment === "card" ? "Card" : "Cash"),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (o) => (
        <span className={u.cellStack}>
          <span className={u.num}>{formatRs(o.total)}</span>
          {o.refunded > 0 && <span className={u.num}>{formatRs(o.refunded)} refunded</span>}
        </span>
      ),
    },
    {
      key: "due",
      header: "Due or delivered",
      align: "right",
      hideOnNarrow: true,
      cell: (o) => (
        <span className={o.lateMin > 0 ? `${u.num} ${u.alertText}` : u.num}>
          {o.deliveredAt ? formatClock(o.deliveredAt) : isFinalStatus(o.status) ? "–" : formatClock(o.dueAt)}
        </span>
      ),
    },
  ];

  const filtersOn = !!(q || status || zone || payment || date !== "today");
  const late = (query.data ?? []).filter((o) => o.lateMin > 0).length;

  return (
    <>
      <PageHeader
        title="Orders"
        description={
          late
            ? `${late} late right now. Open an order to reassign a rider, refund or cancel it.`
            : "Open an order to reassign a rider, refund or cancel it."
        }
      />
      <Toolbar
        label="Filter orders"
        count={query.data ? `${rows.length} ${rows.length === 1 ? "order" : "orders"}` : undefined}
        onClear={
          filtersOn
            ? () => {
                setQ("");
                setParams(openId ? { order: openId } : {}, { replace: true });
              }
            : undefined
        }
      >
        <SearchField
          ref={searchRef}
          label="Search orders"
          placeholder="Order id, customer, phone, restaurant or rider ( / )"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShown(PAGE);
          }}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setParam("status", e.target.value)}
          options={statusOptions}
        />
        <Select
          label="Zone"
          value={zone}
          onChange={(e) => setParam("zone", e.target.value)}
          options={[
            { value: "", label: "All zones" },
            ...(zones.data ?? []).map((z) => ({ value: z.id, label: z.code })),
          ]}
        />
        <Select
          label="Payment"
          value={payment}
          onChange={(e) => setParam("payment", e.target.value)}
          options={[
            { value: "", label: "Card or cash" },
            { value: "card", label: "Card" },
            { value: "cash", label: "Cash on delivery" },
          ]}
        />
        <Select
          label="Date"
          value={date}
          onChange={(e) => setParam("date", e.target.value === "today" ? "" : e.target.value)}
          options={dateOptions}
        />
      </Toolbar>

      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        what="orders"
      />
      {query.data && (
        <>
          <DataTable
            caption="Orders. Choose a row to open the order."
            columns={columns}
            rows={sorted.slice(0, shown)}
            rowKey={(o) => o.id}
            onRowClick={(o) => setParam("order", o.id)}
            selectedKey={openId ?? undefined}
            empty={
              <>
                <strong>No orders match these filters.</strong> Clear the filters or try another date.
              </>
            }
          />
          <ShowMore
            shown={Math.min(shown, sorted.length)}
            total={sorted.length}
            onMore={() => setShown((s) => s + PAGE)}
          />
        </>
      )}

      <OrderDrawer orderId={openId} onClose={() => setParam("order", "")} />
    </>
  );
}
