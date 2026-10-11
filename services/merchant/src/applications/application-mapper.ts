import { DocumentStatus, PartnerDocument } from "@kade/proto/kade/common/v1/onboarding";
import {
  BusinessDetails,
  MenuSubmission,
  OwnerDetails,
  type PartnerApplication,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { applicationStatus } from "../domain/enums.js";
import type { ApplicationRow } from "./applications.repository.js";

/** Display names for the document kinds the restaurant sign-up form uploads. */
export const DOCUMENT_NAMES: Record<string, string> = {
  registration: "Business registration",
  foodSafety: "Food safety certificate (PHI)",
  ownerId: "Owner NIC",
  bank: "Bank details",
  menu: "Menu with prices",
};

export const documentFromJson = (j: Record<string, unknown>): PartnerDocument => PartnerDocument.fromJSON(j);
export const documentToJson = (d: PartnerDocument) => PartnerDocument.toJSON(d) as Record<string, unknown>;

export function toApplication(row: ApplicationRow): PartnerApplication {
  return {
    id: row.id,
    reference: row.reference,
    business: BusinessDetails.fromJSON(row.business),
    owner: OwnerDetails.fromJSON(row.owner),
    documents: row.documents.map(documentFromJson),
    bank: row.bank
      ? {
          bank: row.bank.bank,
          branch: row.bank.branch,
          accountName: row.bank.accountName,
          accountNumber: "",
          accountLast4: row.bank.accountLast4,
        }
      : undefined,
    menu: row.menu ? MenuSubmission.fromJSON(row.menu) : undefined,
    status: applicationStatus.toProto(row.status),
    decisionNote: row.decisionNote,
    zoneId: row.zoneId,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt ?? undefined,
    outletId: row.outletId ?? "",
  };
}

export function allDocumentsApproved(docs: PartnerDocument[]): boolean {
  return docs.every(
    (d) =>
      d.status === DocumentStatus.DOCUMENT_STATUS_APPROVED ||
      d.status === DocumentStatus.DOCUMENT_STATUS_EXPIRING,
  );
}
