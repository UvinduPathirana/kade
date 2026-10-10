import {
  Button,
  Choice,
  ChoiceGroup,
  ConfirmDialog,
  DataTable,
  IconButton,
  Panel,
  Select,
  Sheet,
  Tag,
  TextField,
  useToast,
} from "@kade/ui";
import { useState } from "react";
import { roleDescriptions, roleLabels } from "@/api/partner";
import { useChangeRole, useInviteStaff, useRemoveStaff, useStaff } from "@/api/queries";
import type { StaffMember, StaffRole } from "@/api/types";
import { clockTime, shortDate } from "@/lib/time";
import styles from "./Settings.module.css";

/** The signed-in owner in the demo. */
const ME = "u1";

function lastActive(at: number | null) {
  if (at === null) return <Tag tone="warning">Invite sent</Tag>;
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 60) return mins < 2 ? "Just now" : `${mins} min ago`;
  return new Date(at).toDateString() === new Date().toDateString()
    ? `Today, ${clockTime(at)}`
    : shortDate(at);
}

const roles = Object.keys(roleLabels) as StaffRole[];

export function StaffPanel() {
  const toast = useToast();
  const { data: staff, isPending } = useStaff();
  const changeRole = useChangeRole();
  const remove = useRemoveStaff();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);

  return (
    <Panel
      title="Staff"
      titleId="staff-title"
      className={styles.panel}
      action={
        <Button icon="plus" size="lg" onClick={() => setInviting(true)}>
          Invite staff
        </Button>
      }
    >
      <p className={styles.muted}>
        Everyone signs in with their own phone number, so you can see who accepted what.
      </p>
      {isPending && <p className={styles.muted}>Loading staff…</p>}
      {staff && (
        <DataTable
          caption="Staff"
          rows={staff}
          rowKey={(s) => s.id}
          columns={[
            {
              key: "name",
              header: "Name",
              cell: (s) => (
                <span className={styles.person}>
                  <strong>
                    {s.name}
                    {s.id === ME && " (you)"}
                  </strong>
                  <small>{s.phone}</small>
                </span>
              ),
            },
            {
              key: "role",
              header: "Role",
              width: "200px",
              cell: (s) =>
                s.id === ME ? (
                  roleLabels[s.role]
                ) : (
                  <Select
                    label={`Role for ${s.name}`}
                    hideLabel
                    value={s.role}
                    onChange={(e) =>
                      changeRole.mutate(
                        { id: s.id, role: e.target.value as StaffRole },
                        {
                          onSuccess: () =>
                            toast({
                              title: "Role changed",
                              description: `${s.name} is now ${roleLabels[e.target.value as StaffRole].toLowerCase()}.`,
                            }),
                          onError: (err) =>
                            toast({ title: "Role not changed", description: err.message, tone: "error" }),
                        },
                      )
                    }
                    options={roles.map((r) => ({ value: r, label: roleLabels[r] }))}
                  />
                ),
            },
            {
              key: "active",
              header: "Last active",
              cell: (s) => lastActive(s.lastActive),
              hideOnNarrow: true,
            },
            {
              key: "remove",
              header: <span className="kd-visually-hidden">Remove</span>,
              align: "right",
              cell: (s) =>
                s.id !== ME && (
                  <IconButton
                    icon="trash"
                    variant="soft"
                    label={`Remove ${s.name}`}
                    onClick={() => setRemoving(s)}
                  />
                ),
            },
          ]}
        />
      )}

      <InviteSheet open={inviting} onOpenChange={setInviting} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name}?`}
        description="They're signed out of every device straight away. You can invite them again later."
        cancelLabel="Keep them"
        confirmLabel="Remove"
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => toast({ title: "Staff member removed", description: removing.name }),
          })
        }
      />
    </Panel>
  );
}

function InviteSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const invite = useInviteStaff();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<StaffRole>("kitchen");
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState("");
  const digits = phone.replace(/\D/g, "").replace(/^94/, "").replace(/^0/, "");
  const phoneOk = /^7\d{8}$/.test(digits);
  const close = () => {
    onOpenChange(false);
    setName("");
    setPhone("");
    setRole("kitchen");
    setSubmitted(false);
    setServerError("");
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="Invite staff"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!name.trim() || !phoneOk) return;
        const formatted = `+94 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
        invite.mutate(
          { name: name.trim(), phone: formatted, role },
          {
            onSuccess: () => {
              toast({
                title: "Invite sent",
                description: `${name.trim()} gets an SMS with a link to sign in.`,
                tone: "success",
              });
              close();
            },
            onError: (err) => setServerError(err.message),
          },
        );
      }}
      footer={
        <Button type="submit" size="lg" fullWidth disabled={invite.isPending}>
          Send invite
        </Button>
      }
    >
      <div className={styles.sheetBody}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={submitted && !name.trim() ? "Enter their name." : undefined}
          autoComplete="off"
        />
        <TextField
          label="Mobile number"
          type="tel"
          prefix="+94"
          inputMode="tel"
          placeholder="77 123 4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={
            serverError ||
            (submitted && !phoneOk ? "Enter a Sri Lankan mobile number, for example 77 123 4567." : undefined)
          }
        />
        <ChoiceGroup legend="Role" hint="Required" required complete>
          {roles.map((r) => (
            <Choice
              key={r}
              type="radio"
              name="invite-role"
              checked={role === r}
              onChange={() => setRole(r)}
              label={
                <span className={styles.person}>
                  <strong>{roleLabels[r]}</strong>
                  <small>{roleDescriptions[r]}</small>
                </span>
              }
            />
          ))}
        </ChoiceGroup>
      </div>
    </Sheet>
  );
}
