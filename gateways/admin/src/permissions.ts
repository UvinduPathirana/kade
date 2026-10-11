// What each staff role may do. The matrix is editable on the console's Team page and stored by
// identity (StaffService.GetPermissionMatrix); the gateway enforces it per route. While identity is
// unreachable the defaults below (the console's original grid) apply. Admins can always do everything.

export const STAFF_ROLES = ["admin", "ops", "finance", "support"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface PermissionDef {
  id: string;
  label: string;
  group: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { id: "orders.view", label: "View orders and customers", group: "Orders" },
  { id: "orders.reassign", label: "Assign another rider", group: "Orders" },
  { id: "orders.cancel", label: "Cancel orders", group: "Orders" },
  { id: "orders.refundSmall", label: "Refund up to Rs 5,000", group: "Orders" },
  { id: "orders.refundAny", label: "Refund any amount", group: "Orders" },
  { id: "customers.credit", label: "Issue Kadé credit", group: "Customers" },
  { id: "customers.block", label: "Block customers", group: "Customers" },
  { id: "partners.approve", label: "Approve restaurants and riders", group: "Partners" },
  { id: "partners.suspend", label: "Pause or suspend restaurants and riders", group: "Partners" },
  { id: "partners.commission", label: "Change commission", group: "Partners" },
  { id: "finance.payouts", label: "Approve payout batches", group: "Finance" },
  { id: "finance.cash", label: "Record cash deposits", group: "Finance" },
  { id: "pricing.edit", label: "Edit zones, fees and surcharges", group: "Pricing and content" },
  { id: "promos.edit", label: "Create and pause vouchers", group: "Pricing and content" },
  { id: "content.edit", label: "Edit the home feed", group: "Pricing and content" },
  { id: "team.manage", label: "Invite staff and change roles", group: "Team" },
];

export type Matrix = Record<StaffRole, string[]>;

export const DEFAULT_MATRIX: Matrix = {
  admin: PERMISSIONS.map((p) => p.id),
  ops: [
    "orders.view",
    "orders.reassign",
    "orders.cancel",
    "orders.refundSmall",
    "customers.credit",
    "customers.block",
    "partners.approve",
    "partners.suspend",
    "pricing.edit",
    "promos.edit",
    "content.edit",
  ],
  finance: [
    "orders.view",
    "orders.refundSmall",
    "orders.refundAny",
    "partners.commission",
    "finance.payouts",
    "finance.cash",
  ],
  support: ["orders.view", "orders.refundSmall", "customers.credit"],
};

/** Refunds above this need orders.refundAny; up to it, orders.refundSmall. */
export const SMALL_REFUND_LIMIT = 5000;

export function isStaffRole(r: string): r is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(r);
}

/** True when any of the caller's staff roles has any of `permissions`. */
export function allows(matrix: Matrix, roles: string[], permissions: string | string[]): boolean {
  const wanted = Array.isArray(permissions) ? permissions : [permissions];
  if (roles.includes("admin")) return true;
  return roles.some((r) => isStaffRole(r) && wanted.some((p) => matrix[r].includes(p)));
}

/** The caller's main role for display: admin > ops > finance > support. */
export function primaryRole(roles: string[]): StaffRole | undefined {
  return STAFF_ROLES.find((r) => roles.includes(r));
}

export const ROLE_TITLES: Record<StaffRole, string> = {
  admin: "Admin",
  ops: "Ops",
  finance: "Finance",
  support: "Support",
};
