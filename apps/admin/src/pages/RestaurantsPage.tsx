import { DataTable, SearchField, Select, Tabs, cx, type Column } from "@kade/ui";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useRestaurantApplications, useRestaurants, useZones } from "@/api/queries";
import type { Restaurant, RestaurantApplication } from "@/api/types";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Status } from "@/components/Status";
import { Toolbar } from "@/components/Toolbar";
import u from "@/components/ui.module.css";
import {
  ApplicationDrawer,
  RestaurantDrawer,
  RestaurantStatusTag,
} from "@/features/partners/RestaurantDrawers";
import { formatAgo, formatPercent } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import { useSlashFocus } from "@/lib/useSlashFocus";

type Tab = "all" | "applications";

const statusOptions = [
  { value: "", label: "Any status" },
  { value: "notAccepting", label: "Not accepting" },
  { value: "open", label: "Open" },
  { value: "paused", label: "Paused" },
  { value: "suspended", label: "Suspended" },
  { value: "closed", label: "Closed" },
];

function AllRestaurants({
  rows: all,
  openId,
  onOpen,
}: {
  rows: Restaurant[];
  openId: string | null;
  onOpen: (id: number) => void;
}) {
  const zones = useZones();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [zone, setZone] = useState("");
  const [sort, setSort] = useState("name");
  const ref = useRef<HTMLInputElement>(null);
  useSlashFocus(ref);

  const rows = all
    .filter(
      (r) =>
        (!q ||
          r.name.toLowerCase().includes(q.toLowerCase()) ||
          r.owner.toLowerCase().includes(q.toLowerCase())) &&
        (!zone || r.zoneId === zone) &&
        (!status ||
          (status === "notAccepting"
            ? r.status === "open" && !r.accepting
            : r.status === status && (status !== "open" || r.accepting))),
    )
    .sort((a, b) =>
      sort === "acceptance"
        ? a.acceptanceRate - b.acceptanceRate
        : sort === "orders"
          ? b.ordersWeek - a.ordersWeek
          : sort === "rating"
            ? b.rating - a.rating
            : a.name.localeCompare(b.name),
    );

  const columns: Column<Restaurant>[] = [
    {
      key: "name",
      header: "Restaurant",
      cell: (r) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{r.name}</span>
          <span>{r.cuisine}</span>
        </span>
      ),
    },
    { key: "area", header: "Area", hideOnNarrow: true, cell: (r) => r.area },
    { key: "status", header: "Status", cell: (r) => <RestaurantStatusTag r={r} /> },
    {
      key: "rating",
      header: "Rating",
      align: "right",
      cell: (r) => <span className={u.num}>{r.rating ? r.rating.toFixed(1) : "New"}</span>,
    },
    {
      key: "orders",
      header: "Orders a week",
      align: "right",
      hideOnNarrow: true,
      cell: (r) => <span className={u.num}>{r.ordersWeek}</span>,
    },
    {
      key: "accept",
      header: "Accepted",
      align: "right",
      cell: (r) => (
        <span className={cx(u.num, r.acceptanceRate < 0.85 && u.alertText)}>
          {formatPercent(r.acceptanceRate)}
        </span>
      ),
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      hideOnNarrow: true,
      cell: (r) => <span className={u.num}>{r.commission}%</span>,
    },
  ];

  return (
    <>
      <Toolbar
        label="Filter restaurants"
        count={`${rows.length} restaurants`}
        onClear={q || status || zone ? () => (setQ(""), setStatus(""), setZone("")) : undefined}
      >
        <SearchField
          ref={ref}
          label="Search restaurants"
          placeholder="Name or owner ( / )"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={statusOptions}
        />
        <Select
          label="Zone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          options={[
            { value: "", label: "All zones" },
            ...(zones.data ?? []).map((z) => ({ value: z.id, label: `${z.code}, ${z.name}` })),
          ]}
        />
        <Select
          label="Sort by"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          options={[
            { value: "name", label: "Name" },
            { value: "acceptance", label: "Lowest acceptance first" },
            { value: "orders", label: "Most orders first" },
            { value: "rating", label: "Highest rated first" },
          ]}
        />
      </Toolbar>
      <DataTable
        caption="All restaurants. Choose a row to open the restaurant."
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.id)}
        onRowClick={(r) => onOpen(r.id)}
        selectedKey={openId ?? undefined}
        empty="No restaurants match these filters."
      />
    </>
  );
}

function Applications({
  rows,
  openId,
  onOpen,
}: {
  rows: RestaurantApplication[];
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const now = useNow(60_000);
  const columns: Column<RestaurantApplication>[] = [
    {
      key: "name",
      header: "Applicant",
      cell: (a) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{a.name}</span>
          <span>
            {a.cuisine}, {a.area}
          </span>
        </span>
      ),
    },
    { key: "owner", header: "Owner", hideOnNarrow: true, cell: (a) => a.owner },
    {
      key: "docs",
      header: "Documents",
      cell: (a) => {
        const rejected = a.documents.filter((d) => d.status === "rejected").length;
        const done = a.documents.filter((d) => d.status === "approved").length;
        return rejected ? (
          <Status tone="alert">{rejected} rejected</Status>
        ) : (
          <span className={u.num}>
            {done} of {a.documents.length} approved
          </span>
        );
      },
    },
    { key: "applied", header: "Applied", cell: (a) => formatAgo(a.submittedAt, now) },
    {
      key: "status",
      header: "Status",
      cell: (a) =>
        a.status === "pending" ? (
          <Status tone="progress">To review</Status>
        ) : a.status === "approved" ? (
          <Status tone="live">Approved</Status>
        ) : a.status === "rejected" ? (
          <Status tone="stopped">Rejected</Status>
        ) : (
          <Status tone="done">Waiting for owner</Status>
        ),
    },
  ];
  return (
    <DataTable
      caption="Restaurant applications, oldest first. Choose a row to review documents."
      columns={columns}
      rows={[...rows].sort(
        (a, b) =>
          Number(a.status !== "pending") - Number(b.status !== "pending") || a.submittedAt - b.submittedAt,
      )}
      rowKey={(a) => a.id}
      onRowClick={(a) => onOpen(a.id)}
      selectedKey={openId ?? undefined}
      empty="No applications waiting. New sign-ups from the partner app appear here."
    />
  );
}

export function RestaurantsPage() {
  useDocumentTitle("Restaurants");
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "all";
  const restaurants = useRestaurants();
  const applications = useRestaurantApplications();
  const id = params.get("id");
  const appId = params.get("app");
  const pending = applications.data?.filter((a) => a.status === "pending").length ?? 0;
  const notAccepting = restaurants.data?.filter((r) => r.status === "open" && !r.accepting).length ?? 0;

  const set = (next: Record<string, string>) => setParams(next, { replace: true });

  return (
    <>
      <PageHeader
        title="Restaurants"
        description={
          notAccepting
            ? `${notAccepting} kitchens have stopped accepting orders. ${pending} applications to review.`
            : `${pending} applications to review.`
        }
      />
      <Tabs<Tab>
        label="Restaurant lists"
        value={tab}
        onChange={(t) => set(t === "all" ? {} : { tab: t })}
        items={[
          { value: "all", label: "All restaurants", count: restaurants.data?.length },
          { value: "applications", label: "Applications", count: pending },
        ]}
      >
        {tab === "all" && (
          <>
            <QueryState
              isLoading={restaurants.isLoading}
              error={restaurants.error}
              onRetry={() => void restaurants.refetch()}
              what="restaurants"
            />
            {restaurants.data && (
              <AllRestaurants
                rows={restaurants.data}
                openId={id}
                onOpen={(rid) => set({ id: String(rid) })}
              />
            )}
          </>
        )}
        {tab === "applications" && (
          <>
            <QueryState
              isLoading={applications.isLoading}
              error={applications.error}
              onRetry={() => void applications.refetch()}
              what="applications"
            />
            {applications.data && (
              <Applications
                rows={applications.data}
                openId={appId}
                onOpen={(a) => set({ tab: "applications", app: a })}
              />
            )}
          </>
        )}
      </Tabs>
      <RestaurantDrawer
        r={restaurants.data?.find((r) => String(r.id) === id)}
        onClose={() => set(tab === "all" ? {} : { tab })}
      />
      <ApplicationDrawer
        app={applications.data?.find((a) => a.id === appId)}
        onClose={() => set({ tab: "applications" })}
      />
    </>
  );
}
