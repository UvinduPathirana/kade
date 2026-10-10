import { DataTable, SearchField, Select, Tabs, cx, formatRs, type Column } from "@kade/ui";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useRiderApplications, useRiders, useZones } from "@/api/queries";
import type { Rider, RiderApplication } from "@/api/types";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Status } from "@/components/Status";
import { Toolbar } from "@/components/Toolbar";
import u from "@/components/ui.module.css";
import { RiderApplicationDrawer, RiderDrawer, RiderStatusTag } from "@/features/partners/RiderDrawers";
import { vehicleLabels, worstDoc } from "@/features/partners/riderHelpers";
import { formatAgo, formatDate, formatPercent } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import { useSlashFocus } from "@/lib/useSlashFocus";

type Tab = "all" | "applications";

function DocsCell({ r }: { r: Rider }) {
  const worst = worstDoc(r.documents);
  if (!worst) return <span className={u.muted}>Up to date</span>;
  if (worst.days < 0) return <Status tone="alert">{worst.doc.kind} expired</Status>;
  return (
    <span className={u.cellStack}>
      <span className={u.strong}>{worst.doc.kind}</span>
      <span>Expires {formatDate(worst.doc.expiresOn!)}</span>
    </span>
  );
}

function AllRiders({
  rows: all,
  openId,
  onOpen,
}: {
  rows: Rider[];
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const zones = useZones();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [zone, setZone] = useState("");
  const [attention, setAttention] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useSlashFocus(ref);
  const code = (id: string) => zones.data?.find((z) => z.id === id)?.code.replace("Colombo ", "") ?? id;

  const rows = all.filter((r) => {
    if (
      q &&
      !r.name.toLowerCase().includes(q.toLowerCase()) &&
      !r.id.toLowerCase().includes(q.toLowerCase()) &&
      !r.phone.replaceAll(" ", "").includes(q.replaceAll(" ", ""))
    )
      return false;
    if (status && (status === "online" ? r.status !== "online" && r.status !== "onJob" : r.status !== status))
      return false;
    if (zone && !r.zoneIds.includes(zone)) return false;
    if (attention === "cash" && r.cashHeld <= r.cashLimit) return false;
    if (attention === "docs" && !worstDoc(r.documents)) return false;
    if (attention === "acceptance" && r.acceptanceRate >= 0.8) return false;
    return true;
  });

  const columns: Column<Rider>[] = [
    {
      key: "name",
      header: "Rider",
      cell: (r) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{r.name}</span>
          <span>
            {r.id}, {vehicleLabels[r.vehicle].toLowerCase()}
          </span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <RiderStatusTag r={r} /> },
    {
      key: "zones",
      header: "Zones",
      hideOnNarrow: true,
      cell: (r) => <span className={u.num}>{r.zoneIds.map(code).join(", ")}</span>,
    },
    {
      key: "rating",
      header: "Rating",
      align: "right",
      cell: (r) => <span className={u.num}>{r.rating.toFixed(1)}</span>,
    },
    {
      key: "accept",
      header: "Accepted",
      align: "right",
      hideOnNarrow: true,
      cell: (r) => (
        <span className={cx(u.num, r.acceptanceRate < 0.8 && u.alertText)}>
          {formatPercent(r.acceptanceRate)}
        </span>
      ),
    },
    {
      key: "cash",
      header: "Cash held",
      align: "right",
      cell: (r) => (
        <span className={cx(u.num, r.cashHeld > r.cashLimit && u.alertText)}>{formatRs(r.cashHeld)}</span>
      ),
    },
    { key: "docs", header: "Documents", hideOnNarrow: true, cell: (r) => <DocsCell r={r} /> },
  ];

  return (
    <>
      <Toolbar
        label="Filter riders"
        count={`${rows.length} riders`}
        onClear={
          q || status || zone || attention
            ? () => (setQ(""), setStatus(""), setZone(""), setAttention(""))
            : undefined
        }
      >
        <SearchField
          ref={ref}
          label="Search riders"
          placeholder="Name, id or phone ( / )"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "", label: "Any status" },
            { value: "online", label: "Online" },
            { value: "offline", label: "Offline" },
            { value: "suspended", label: "Suspended" },
          ]}
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
          label="Needs attention"
          value={attention}
          onChange={(e) => setAttention(e.target.value)}
          options={[
            { value: "", label: "Everyone" },
            { value: "cash", label: "Over cash limit" },
            { value: "docs", label: "Documents expiring" },
            { value: "acceptance", label: "Accepting under 80%" },
          ]}
        />
      </Toolbar>
      <DataTable
        caption="All riders. Choose a row to open the rider."
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => onOpen(r.id)}
        selectedKey={openId ?? undefined}
        empty="No riders match these filters."
      />
    </>
  );
}

function Applications({
  rows,
  openId,
  onOpen,
}: {
  rows: RiderApplication[];
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const now = useNow(60_000);
  const columns: Column<RiderApplication>[] = [
    {
      key: "name",
      header: "Applicant",
      cell: (a) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{a.name}</span>
          <span>{vehicleLabels[a.vehicle]}</span>
        </span>
      ),
    },
    {
      key: "docs",
      header: "Documents",
      cell: (a) => {
        const rejected = a.documents.filter((d) => d.status === "rejected").length;
        const ok = a.documents.filter((d) => d.status === "approved").length;
        return rejected ? (
          <Status tone="alert">{rejected} rejected</Status>
        ) : (
          <span className={u.num}>
            {ok} of {a.documents.length} approved
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
          <Status tone="done">Waiting for documents</Status>
        ),
    },
  ];
  return (
    <DataTable
      caption="Rider applications, oldest first. Choose a row to review documents."
      columns={columns}
      rows={[...rows].sort(
        (a, b) =>
          Number(a.status !== "pending") - Number(b.status !== "pending") || a.submittedAt - b.submittedAt,
      )}
      rowKey={(a) => a.id}
      onRowClick={(a) => onOpen(a.id)}
      selectedKey={openId ?? undefined}
      empty="No applications waiting. Sign-ups from the rider app appear here."
    />
  );
}

export function RidersPage() {
  useDocumentTitle("Riders");
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "all";
  const riders = useRiders();
  const applications = useRiderApplications();
  const id = params.get("id");
  const appId = params.get("app");
  const set = (next: Record<string, string>) => setParams(next, { replace: true });
  const pending = applications.data?.filter((a) => a.status === "pending").length ?? 0;
  const online = riders.data?.filter((r) => r.status === "online" || r.status === "onJob").length ?? 0;
  const overCash = riders.data?.filter((r) => r.cashHeld > r.cashLimit).length ?? 0;
  const expired = riders.data?.filter((r) => (worstDoc(r.documents)?.days ?? 1) < 0).length ?? 0;

  return (
    <>
      <PageHeader
        title="Riders"
        description={`${online} online now. ${overCash} over their cash limit, ${expired} with an expired document, ${pending} applications to review.`}
      />
      <Tabs<Tab>
        label="Rider lists"
        value={tab}
        onChange={(t) => set(t === "all" ? {} : { tab: t })}
        items={[
          { value: "all", label: "All riders", count: riders.data?.length },
          { value: "applications", label: "Applications", count: pending },
        ]}
      >
        {tab === "all" && (
          <>
            <QueryState
              isLoading={riders.isLoading}
              error={riders.error}
              onRetry={() => void riders.refetch()}
              what="riders"
            />
            {riders.data && <AllRiders rows={riders.data} openId={id} onOpen={(rid) => set({ id: rid })} />}
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
      <RiderDrawer
        rider={riders.data?.find((r) => r.id === id)}
        onClose={() => set(tab === "all" ? {} : { tab })}
      />
      <RiderApplicationDrawer
        app={applications.data?.find((a) => a.id === appId)}
        onClose={() => set({ tab: "applications" })}
      />
    </>
  );
}
