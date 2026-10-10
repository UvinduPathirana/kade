// Restaurants and riders. Later: the partner service (restaurant onboarding, commission, status) and
// the rider service (onboarding documents, zones, suspension).
import { ApiError, audit, find, respond } from "./client";
import { restaurantApplications, restaurants, riderApplications, riders } from "./mock/partners";
import { zones } from "./mock/zones";
import type { DocStatus, RestaurantStatus, Rider } from "./types";

/* ---------- Restaurants ---------- */

export const listRestaurants = () => respond(restaurants);
export const listRestaurantApplications = () => respond(restaurantApplications);

export async function decideRestaurantApplication({
  id,
  decision,
  note,
}: {
  id: string;
  decision: "approved" | "changesRequested" | "rejected";
  note: string;
}) {
  const a = find(restaurantApplications, (x) => x.id === id, "Application");
  a.status = decision;
  a.decisionNote = note || undefined;
  if (decision === "approved") {
    a.documents.forEach((d) => (d.status = "approved"));
    restaurants.push({
      id: restaurants.length + 100,
      name: a.name,
      area: a.area,
      zoneId: a.zoneId,
      cuisine: a.cuisine,
      category: "rice",
      imageId: "1504674900247-0877df9cc836",
      rating: 0,
      ordersWeek: 0,
      acceptanceRate: 1,
      commission: 18,
      status: "closed",
      statusReason: "New partner: menu being set up",
      accepting: false,
      owner: a.owner,
      phone: a.phone,
      email: a.email,
      joinedOn: "2026-10-10",
      bank: "Pending verification",
      etaMin: 25,
      hasOffer: false,
    });
  }
  const verb = { approved: "Approved", changesRequested: "Requested changes to", rejected: "Rejected" }[
    decision
  ];
  audit({
    action: `${verb} restaurant application`,
    recordType: "restaurant",
    recordId: id,
    detail: note || a.name,
  });
  return respond(a);
}

export async function setRestaurantDocStatus({
  applicationId,
  docId,
  status,
}: {
  applicationId: string;
  docId: string;
  status: DocStatus;
}) {
  const a = find(restaurantApplications, (x) => x.id === applicationId, "Application");
  const d = find(a.documents, (x) => x.id === docId, "Document");
  d.status = status;
  return respond(a);
}

export async function updateCommission({ id, commission }: { id: number; commission: number }) {
  if (!Number.isFinite(commission) || commission < 0 || commission > 35)
    throw new ApiError("Commission must be between 0% and 35%.");
  const r = find(restaurants, (x) => x.id === id, "Restaurant");
  const before = r.commission;
  r.commission = commission;
  audit({
    action: `Changed commission from ${before}% to ${commission}%`,
    recordType: "restaurant",
    recordId: String(id),
    detail: r.name,
  });
  return respond(r);
}

export async function setRestaurantStatus({
  id,
  status,
  reason,
}: {
  id: number;
  status: RestaurantStatus;
  reason: string;
}) {
  const r = find(restaurants, (x) => x.id === id, "Restaurant");
  r.status = status;
  r.statusReason = status === "open" ? undefined : reason;
  r.accepting = status === "open";
  r.waitingMinutes = undefined;
  const verb = { open: "Reopened", paused: "Paused", suspended: "Suspended", closed: "Closed" }[status];
  audit({
    action: `${verb} restaurant`,
    recordType: "restaurant",
    recordId: String(id),
    detail: reason || r.name,
  });
  return respond(r);
}

/* ---------- Riders ---------- */

export const listRiders = () => respond(riders);
export const listRiderApplications = () => respond(riderApplications);
export const listZones = () => respond(zones);

export async function reviewRiderDoc({
  applicationId,
  docId,
  status,
  reason,
}: {
  applicationId: string;
  docId: string;
  status: DocStatus;
  reason?: string;
}) {
  const a = find(riderApplications, (x) => x.id === applicationId, "Application");
  const d = find(a.documents, (x) => x.id === docId, "Document");
  d.status = status;
  d.rejectReason = status === "rejected" ? reason : undefined;
  audit({
    action: status === "approved" ? `Approved ${d.kind.toLowerCase()}` : `Rejected ${d.kind.toLowerCase()}`,
    recordType: "rider",
    recordId: applicationId,
    detail: status === "rejected" ? reason : a.name,
  });
  return respond(a);
}

export async function decideRiderApplication({
  id,
  decision,
  note,
}: {
  id: string;
  decision: "approved" | "changesRequested" | "rejected";
  note: string;
}) {
  const a = find(riderApplications, (x) => x.id === id, "Application");
  if (decision === "approved" && a.documents.some((d) => d.status !== "approved"))
    throw new ApiError("Approve every document before approving the rider.");
  a.status = decision;
  a.decisionNote = note || undefined;
  if (decision === "approved") {
    riders.push({
      id: `R-${101 + riders.length}`,
      name: a.name,
      phone: a.phone,
      vehicle: a.vehicle,
      status: "offline",
      zoneIds: a.zoneIds,
      rating: 5,
      acceptanceRate: 1,
      cashHeld: 0,
      cashLimit: 15000,
      tripsWeek: 0,
      joinedOn: "2026-10-10",
      documents: a.documents,
      pos: { zoneId: a.zoneIds[0] ?? "c03", x: 0.5, y: 0.5 },
    });
  }
  const verb = {
    approved: "Approved",
    changesRequested: "Asked for new documents from",
    rejected: "Rejected",
  }[decision];
  audit({ action: `${verb} rider applicant`, recordType: "rider", recordId: id, detail: note || a.name });
  return respond(a);
}

export async function setRiderZones({ id, zoneIds }: { id: string; zoneIds: string[] }) {
  if (zoneIds.length === 0) throw new ApiError("Choose at least one zone.");
  const r = find(riders, (x) => x.id === id, "Rider");
  r.zoneIds = zoneIds;
  const codes = zoneIds.map((z) => zones.find((x) => x.id === z)?.code).join(", ");
  audit({ action: "Changed rider zones", recordType: "rider", recordId: id, detail: codes });
  return respond(r);
}

export async function setRiderSuspended({
  id,
  suspended,
  reason,
}: {
  id: string;
  suspended: boolean;
  reason: string;
}) {
  const r = find(riders, (x) => x.id === id, "Rider");
  r.status = suspended ? "suspended" : "offline";
  r.statusReason = suspended ? reason : undefined;
  audit({
    action: suspended ? "Suspended rider" : "Reinstated rider",
    recordType: "rider",
    recordId: id,
    detail: reason || r.name,
  });
  return respond<Rider>(r);
}
