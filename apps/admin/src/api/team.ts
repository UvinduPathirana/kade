// Team API. Later: the identity service (staff accounts, role permissions, invites) and its audit log,
// which every other service writes to.
import { ApiError, audit, find, respond } from "./client";
import { auditLog } from "./mock/backOffice";
import { permissionMatrix, permissions, staff } from "./mock/partners";
import type { PermissionMatrix, Role } from "./types";

export const roleLabels: Record<Role, string> = {
  admin: "Admin",
  ops: "Ops",
  finance: "Finance",
  support: "Support",
};

export const listStaff = () => respond(staff);
export const listAudit = () => respond(auditLog);
export const getPermissions = () => respond({ permissions, matrix: permissionMatrix });

export async function inviteStaff({ name, email, role }: { name: string; email: string; role: Role }) {
  const clean = email.trim().toLowerCase();
  if (!name.trim()) throw new ApiError("Enter their full name.");
  if (!/^[^@\s]+@kade\.lk$/.test(clean)) throw new ApiError("Use their @kade.lk work email.");
  if (staff.some((s) => s.email === clean)) throw new ApiError(`${clean} is already on the team.`);
  const s = {
    id: `S-${staff.length + 1}`,
    name: name.trim(),
    email: clean,
    role,
    title: roleLabels[role],
    status: "invited" as const,
  };
  staff.push(s);
  audit({
    action: "Invited staff member",
    recordType: "team",
    recordId: s.id,
    detail: `${s.name}, ${roleLabels[role]}`,
  });
  return respond(s);
}

export async function changeRole({ id, role }: { id: string; role: Role }) {
  const s = find(staff, (x) => x.id === id, "Staff member");
  if (s.role === "admin" && role !== "admin" && staff.filter((x) => x.role === "admin").length === 1)
    throw new ApiError("Kadé needs at least one admin. Make someone else an admin first.");
  const before = roleLabels[s.role];
  s.role = role;
  audit({
    action: `Changed role from ${before} to ${roleLabels[role]}`,
    recordType: "team",
    recordId: id,
    detail: s.name,
  });
  return respond(s);
}

export async function savePermissions(matrix: PermissionMatrix) {
  const changes: string[] = [];
  for (const role of Object.keys(matrix) as Role[]) {
    if (role === "admin") continue;
    const before = new Set(permissionMatrix[role]);
    const after = new Set(matrix[role]);
    const added = [...after].filter((p) => !before.has(p)).length;
    const removed = [...before].filter((p) => !after.has(p)).length;
    if (added || removed) changes.push(`${roleLabels[role]}: ${added} added, ${removed} removed`);
    permissionMatrix[role] = [...after];
  }
  if (changes.length)
    audit({
      action: "Changed role permissions",
      recordType: "team",
      recordId: "roles",
      detail: changes.join("; "),
    });
  return respond(permissionMatrix);
}
