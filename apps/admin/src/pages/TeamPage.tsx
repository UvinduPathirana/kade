import {
  Button,
  Choice,
  ConfirmDialog,
  DataTable,
  Link,
  SearchField,
  Select,
  Tabs,
  TextField,
  cx,
  useToast,
  type Column,
} from "@kade/ui";
import { Fragment, useState } from "react";
import { useSearchParams } from "react-router";
import { ME } from "@/api/client";
import { DAY, TODAY_START } from "@/api/client";
import {
  useAudit,
  useChangeRole,
  useInviteStaff,
  usePermissions,
  useSavePermissions,
  useStaff,
} from "@/api/queries";
import { roleLabels } from "@/api/team";
import type { AuditEntry, Permission, PermissionMatrix, Role, Staff } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Status } from "@/components/Status";
import { Toolbar } from "@/components/Toolbar";
import u from "@/components/ui.module.css";
import { formatAgo, formatWhen } from "@/lib/format";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./TeamPage.module.css";

type Tab = "staff" | "roles" | "audit";
const roles: Role[] = ["admin", "ops", "finance", "support"];
const roleHelp: Record<Role, string> = {
  admin: "Everything, including team and permissions",
  ops: "Live orders, riders, restaurants, pricing and content",
  finance: "Payouts, settlements, cash and large refunds",
  support: "Tickets, small refunds and credit",
};

/* ---------- Staff ---------- */

function RoleChoices({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <fieldset className={u.fieldset}>
      <legend className={u.legend}>Role</legend>
      {roles.map((r) => (
        <Choice
          key={r}
          type="radio"
          name="role"
          checked={value === r}
          onChange={() => onChange(r)}
          label={
            <span className={u.cellStack}>
              <span className={u.strong}>{roleLabels[r]}</span>
              <span>{roleHelp[r]}</span>
            </span>
          }
        />
      ))}
    </fieldset>
  );
}

function InviteSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const mutation = useInviteStaff();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("support");
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Invite someone to Kadé Ops"
      submitLabel="Send invite"
      pending={mutation.isPending}
      validate={() => {
        if (!name.trim()) return "Enter their full name.";
        if (!/^[^@\s]+@kade\.lk$/i.test(email.trim())) return "Use their @kade.lk work email.";
        return null;
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({ name, email, role });
        toast({
          title: "Invite sent",
          description: `${email.trim().toLowerCase()} can sign in once they accept.`,
          tone: "success",
        });
      }}
    >
      <TextField
        label="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="off"
      />
      <TextField
        label="Work email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="name@kade.lk"
        autoComplete="off"
      />
      <RoleChoices value={role} onChange={setRole} />
    </ActionSheet>
  );
}

function RoleSheet({ person, onClose }: { person: Staff; onClose: () => void }) {
  const toast = useToast();
  const mutation = useChangeRole();
  const [role, setRole] = useState<Role>(person.role);
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Change ${person.name}'s role`}
      submitLabel="Change role"
      pending={mutation.isPending}
      validate={() =>
        role === person.role
          ? `${person.name.split(" ")[0]} is already ${roleLabels[role]}. Choose a different role.`
          : null
      }
      confirm={{
        title: `Make ${person.name.split(" ")[0]} ${roleLabels[role]}?`,
        description: `Their access changes the next time they load a page: ${roleHelp[role].toLowerCase()}.`,
        confirmLabel: "Change role",
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({ id: person.id, role });
        toast({
          title: "Role changed",
          description: `${person.name} is now ${roleLabels[role]}.`,
          tone: "success",
        });
      }}
    >
      <RoleChoices value={role} onChange={setRole} />
    </ActionSheet>
  );
}

function StaffTab({ rows }: { rows: Staff[] }) {
  const now = useNow(60_000);
  const [editing, setEditing] = useState<Staff | null>(null);
  const columns: Column<Staff>[] = [
    {
      key: "name",
      header: "Name",
      cell: (s) => (
        <span className={u.cellStack}>
          <span className={u.strong}>
            {s.name}
            {s.id === ME.id && <span className={u.muted}> (you)</span>}
          </span>
          <span>{s.title}</span>
        </span>
      ),
    },
    { key: "email", header: "Email", hideOnNarrow: true, cell: (s) => s.email },
    { key: "role", header: "Role", cell: (s) => roleLabels[s.role] },
    {
      key: "active",
      header: "Last active",
      cell: (s) =>
        s.status === "invited" ? (
          <Status tone="progress">Invite sent</Status>
        ) : s.lastActiveAt && now - s.lastActiveAt < 10 * 60_000 ? (
          <Status tone="live">Online</Status>
        ) : (
          <span className={u.muted}>{s.lastActiveAt ? formatAgo(s.lastActiveAt, now) : "Never"}</span>
        ),
    },
    {
      key: "edit",
      header: <span className="kd-visually-hidden">Change role</span>,
      cell: (s) => (
        <button
          type="button"
          className={u.textButton}
          onClick={() => setEditing(s)}
          aria-label={`Change ${s.name}'s role`}
        >
          Change role
        </button>
      ),
    },
  ];
  return (
    <>
      <DataTable caption="Kadé Ops staff" columns={columns} rows={rows} rowKey={(s) => s.id} />
      {editing && <RoleSheet person={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/* ---------- Permissions matrix ---------- */

function PermissionsTab({ permissions, matrix }: { permissions: Permission[]; matrix: PermissionMatrix }) {
  const toast = useToast();
  const mutation = useSavePermissions();
  const [draft, setDraft] = useState<PermissionMatrix>(matrix);
  const [confirming, setConfirming] = useState(false);
  const dirty = roles.some((r) => [...draft[r]].sort().join() !== [...matrix[r]].sort().join());
  const groups = [...new Set(permissions.map((p) => p.group))];
  const toggle = (role: Role, id: string) =>
    setDraft((d) => ({
      ...d,
      [role]: d[role].includes(id) ? d[role].filter((x) => x !== id) : [...d[role], id],
    }));

  return (
    <div className={u.stackTight}>
      <div className={styles.matrixWrap}>
        <table className={styles.matrix}>
          <caption className={styles.caption}>
            What each role can do. Admins can always do everything, so their column can't be changed.
          </caption>
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {roles.map((r) => (
                <th key={r} scope="col">
                  {roleLabels[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr className={styles.groupRow}>
                  <th scope="colgroup" colSpan={roles.length + 1}>
                    {g}
                  </th>
                </tr>
                {permissions
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <tr key={p.id}>
                      <th scope="row">{p.label}</th>
                      {roles.map((r) => (
                        <td key={r}>
                          <input
                            type="checkbox"
                            className={styles.box}
                            checked={r === "admin" || draft[r].includes(p.id)}
                            disabled={r === "admin"}
                            onChange={() => toggle(r, p.id)}
                            aria-label={`${roleLabels[r]}: ${p.label}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.saveBar} aria-live="polite">
        {dirty ? (
          <span>You have unsaved changes.</span>
        ) : (
          <span className={u.muted}>Changes apply the next time each person loads a page.</span>
        )}
        <div className={u.row}>
          <Button size="sm" variant="secondary" disabled={!dirty} onClick={() => setDraft(matrix)}>
            Discard
          </Button>
          <Button size="sm" disabled={!dirty || mutation.isPending} onClick={() => setConfirming(true)}>
            Save permissions
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Save permission changes?"
        description="Everyone with these roles gets the new access straight away. The change is written to the audit log."
        confirmLabel="Save permissions"
        cancelLabel="Go back"
        onConfirm={() =>
          mutation.mutate(draft, {
            onSuccess: () => toast({ title: "Permissions saved", tone: "success" }),
            onError: (e) => toast({ title: "Permissions not saved", description: e.message, tone: "error" }),
          })
        }
      />
    </div>
  );
}

/* ---------- Audit log ---------- */

const recordLabels: Record<AuditEntry["recordType"], string> = {
  order: "Order",
  restaurant: "Restaurant",
  rider: "Rider",
  customer: "Customer",
  payout: "Payout",
  zone: "Pricing",
  voucher: "Voucher",
  ticket: "Ticket",
  content: "Home feed",
  team: "Team",
};

const recordHref = (e: AuditEntry): string | undefined => {
  switch (e.recordType) {
    case "order":
      return `/orders?order=${e.recordId}&date=week`;
    case "restaurant":
      return e.recordId.startsWith("RA-")
        ? `/restaurants?tab=applications&app=${e.recordId}`
        : `/restaurants?id=${e.recordId}`;
    case "rider":
      return e.recordId.startsWith("RAP-")
        ? `/riders?tab=applications&app=${e.recordId}`
        : `/riders?id=${e.recordId}`;
    case "customer":
      return `/customers?id=${e.recordId}`;
    case "voucher":
      return `/promotions?code=${e.recordId}`;
    case "ticket":
      return `/support?ticket=${e.recordId}`;
    case "payout":
      return "/finance";
    case "zone":
      return "/zones";
    case "content":
      return "/content";
    default:
      return undefined;
  }
};

function AuditTab({ rows: all }: { rows: AuditEntry[] }) {
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const [type, setType] = useState("");
  const [range, setRange] = useState("week");
  const actors = [...new Set(all.map((e) => e.actor))].sort();
  const from = range === "today" ? TODAY_START : range === "week" ? TODAY_START - 6 * DAY : 0;
  const rows = all.filter(
    (e) =>
      e.at >= from &&
      (!actor || e.actor === actor) &&
      (!type || e.recordType === type) &&
      (!q || `${e.action} ${e.detail ?? ""} ${e.recordId}`.toLowerCase().includes(q.toLowerCase())),
  );

  const columns: Column<AuditEntry>[] = [
    { key: "when", header: "When", cell: (e) => <span className={u.num}>{formatWhen(e.at)}</span> },
    { key: "who", header: "Who", cell: (e) => e.actor },
    {
      key: "what",
      header: "What",
      cell: (e) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{e.action}</span>
          {e.detail && <span>{e.detail}</span>}
        </span>
      ),
    },
    {
      key: "record",
      header: "Record",
      cell: (e) => {
        const href = recordHref(e);
        return (
          <span className={u.cellStack}>
            <span>{recordLabels[e.recordType]}</span>
            {href ? (
              <Link href={href} className={cx(u.textButton, styles.recordLink)}>
                {e.recordId}
              </Link>
            ) : (
              <span>{e.recordId}</span>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <Toolbar
        label="Filter audit log"
        count={`${rows.length} entries`}
        onClear={
          q || actor || type || range !== "week"
            ? () => (setQ(""), setActor(""), setType(""), setRange("week"))
            : undefined
        }
      >
        <SearchField
          label="Search the audit log"
          placeholder="Action, detail or record id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Who"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          options={[{ value: "", label: "Anyone" }, ...actors.map((a) => ({ value: a, label: a }))]}
        />
        <Select
          label="Record"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[
            { value: "", label: "Any record" },
            ...(Object.keys(recordLabels) as AuditEntry["recordType"][]).map((t) => ({
              value: t,
              label: recordLabels[t],
            })),
          ]}
        />
        <Select
          label="When"
          value={range}
          onChange={(e) => setRange(e.target.value)}
          options={[
            { value: "today", label: "Today" },
            { value: "week", label: "Last 7 days" },
            { value: "all", label: "Everything" },
          ]}
        />
      </Toolbar>
      <DataTable
        caption="Audit log, newest first"
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
        empty="Nothing matches. Widen the date range or clear the filters."
      />
    </>
  );
}

/* ---------- Page ---------- */

export function TeamPage() {
  useDocumentTitle("Team and audit");
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "staff";
  const staff = useStaff();
  const perms = usePermissions();
  const audit = useAudit();
  const [inviting, setInviting] = useState(false);

  return (
    <>
      <PageHeader
        title="Team and audit"
        description="Who can use Kadé Ops, what each role can do, and every change anyone has made."
        actions={
          tab === "staff" && (
            <Button icon="plus" onClick={() => setInviting(true)}>
              Invite staff
            </Button>
          )
        }
      />
      <Tabs<Tab>
        label="Team sections"
        value={tab}
        onChange={(t) => setParams(t === "staff" ? {} : { tab: t }, { replace: true })}
        items={[
          { value: "staff", label: "Staff", count: staff.data?.length },
          { value: "roles", label: "Roles and permissions" },
          { value: "audit", label: "Audit log" },
        ]}
      >
        {tab === "staff" && (
          <>
            <QueryState
              isLoading={staff.isLoading}
              error={staff.error}
              onRetry={() => void staff.refetch()}
              what="staff"
            />
            {staff.data && <StaffTab rows={staff.data} />}
          </>
        )}
        {tab === "roles" && (
          <>
            <QueryState
              isLoading={perms.isLoading}
              error={perms.error}
              onRetry={() => void perms.refetch()}
              what="permissions"
            />
            {perms.data && (
              <PermissionsTab
                key={JSON.stringify(perms.data.matrix)}
                permissions={perms.data.permissions}
                matrix={perms.data.matrix}
              />
            )}
          </>
        )}
        {tab === "audit" && (
          <>
            <QueryState
              isLoading={audit.isLoading}
              error={audit.error}
              onRetry={() => void audit.refetch()}
              what="the audit log"
            />
            {audit.data && <AuditTab rows={audit.data} />}
          </>
        )}
      </Tabs>
      {inviting && <InviteSheet onClose={() => setInviting(false)} />}
    </>
  );
}
