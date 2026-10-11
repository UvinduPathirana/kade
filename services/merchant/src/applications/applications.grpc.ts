import { Inject, Injectable } from "@nestjs/common";
import {
  DocumentStatus,
  ApplicationStatus,
  type PartnerDocument,
} from "@kade/proto/kade/common/v1/onboarding";
import { RestaurantKind } from "@kade/proto/kade/catalog/v1/catalog_service";
import {
  BusinessDetails,
  BusinessType,
  DecideApplicationRequest,
  DecideApplicationResponse,
  MenuSubmission,
  MenuSubmissionMethod,
  OwnerDetails,
  PartnerApplicationServiceService,
  SubmitApplicationRequest,
  SubmitApplicationResponse,
  type GetApplicationRequest,
  type GetApplicationResponse,
  type GetMyApplicationRequest,
  type GetMyApplicationResponse,
  type ListApplicationsRequest,
  type ListApplicationsResponse,
  type SetApplicationDocumentStatusRequest,
  type SetApplicationDocumentStatusResponse,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { randomInt } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import type { BankJson } from "../db/schema.js";
import { applicationStatus } from "../domain/enums.js";
import { actorOf, MerchantEvents } from "../domain/merchant-events.js";
import { decodePage, encodePage } from "../domain/paging.js";
import { normalisePhone, zoneForArea } from "../domain/values.js";
import { OutletAccess } from "../outlets/outlet-access.js";
import { DEFAULT_SETTINGS, settingsToJson } from "../outlets/outlet-mapper.js";
import { OutletsRepository } from "../outlets/outlets.repository.js";
import { Database, type Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { alreadyExists, failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { StaffRepository } from "../staff/staff.repository.js";
import {
  allDocumentsApproved,
  DOCUMENT_NAMES,
  documentFromJson,
  documentToJson,
  toApplication,
} from "./application-mapper.js";
import { ApplicationsRepository, type ApplicationRow } from "./applications.repository.js";
import { CatalogClient } from "./catalog-client.js";

export const DEFAULT_COMMISSION_BPS = 1800;
const MAX_COMMISSION_BPS = 3500;

/** kade.merchant.v1.PartnerApplicationService: restaurant onboarding, from the sign-up form to approval. */
@GrpcService(PartnerApplicationServiceService)
@Injectable()
export class ApplicationsGrpcService implements GrpcHandlers<PartnerApplicationServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ApplicationsRepository) private readonly applications: ApplicationsRepository,
    @Inject(OutletsRepository) private readonly outlets: OutletsRepository,
    @Inject(StaffRepository) private readonly staff: StaffRepository,
    @Inject(OutletAccess) private readonly access: OutletAccess,
    @Inject(MerchantEvents) private readonly events: MerchantEvents,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
    @Inject(CatalogClient) private readonly catalog: CatalogClient,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Signed out: anyone may apply. One open application per phone; changes-requested ones are replaced. */
  async submitApplication(
    request: SubmitApplicationRequest,
    ctx: RequestContext,
  ): Promise<SubmitApplicationResponse> {
    const input = validateSubmission(request);
    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `SubmitApplication:${input.phone}`,
          key: request.idempotencyKey,
          request: SubmitApplicationRequest.encode(request).finish(),
          codec: SubmitApplicationResponse,
        },
        async () => {
          const now = new Date();
          const previous = await this.applications.latestByPhone(tx, input.phone);
          if (previous?.status === "pending") {
            throw alreadyExists(
              "APPLICATION_PENDING",
              `You already applied (reference ${previous.reference}). We'll be in touch.`,
              {
                reference: previous.reference,
              },
            );
          }
          if (previous?.status === "approved") {
            throw alreadyExists(
              "ALREADY_PARTNER",
              "This number already belongs to a Kadé partner. Sign in instead.",
            );
          }
          const documents = input.documents.map((d) => documentToJson({ ...d, uploadedAt: now }));
          const fields = {
            ownerPhone: input.phone,
            business: BusinessDetails.toJSON(input.business) as Record<string, unknown>,
            owner: OwnerDetails.toJSON(input.owner) as Record<string, unknown>,
            documents,
            bank: input.bank,
            bankAccountNumber: input.bankAccountNumber,
            menu: MenuSubmission.toJSON(input.menu) as Record<string, unknown>,
            status: "pending",
            decisionNote: "",
            zoneId: zoneForArea(input.business.area, input.business.city),
            submittedAt: now,
            decidedAt: null,
          };
          let row: ApplicationRow | undefined;
          if (previous?.status === "changes_requested") {
            // Resubmission after "changes requested": same application and reference, back in the queue.
            row = await this.applications.update(tx, previous.id, fields);
          } else {
            for (let attempt = 0; !row && attempt < 8; attempt++) {
              row = await this.applications.insert(tx, {
                id: uuidv7(),
                reference: `KP-${randomInt(10_000, 100_000)}`,
                ...fields,
              });
            }
            if (!row) throw new Error("could not allocate an application reference");
          }
          const application = toApplication(row);
          await this.events.applicationSubmitted(tx, {
            applicationId: row.id,
            application,
            occurredAt: now,
          });
          return { application };
        },
      ),
    );
  }

  async getMyApplication(
    request: GetMyApplicationRequest,
    ctx: RequestContext,
  ): Promise<GetMyApplicationResponse> {
    // Signed-out applicants are identified by phone; the gateway may pass it as x-user-id instead.
    const fromHeader = ctx.userId && /^\+?\d[\d\s]{8,14}$/.test(ctx.userId) ? ctx.userId : "";
    const raw = request.phone.trim() || fromHeader;
    if (!raw)
      throw invalidArgument("PHONE_REQUIRED", "Enter the phone number you applied with.", { field: "phone" });
    const row = await this.applications.latestByPhone(this.database.db, normalisePhone(raw));
    return { application: row ? toApplication(row) : undefined };
  }

  async listApplications(
    request: ListApplicationsRequest,
    ctx: RequestContext,
  ): Promise<ListApplicationsResponse> {
    this.access.requireOps(ctx);
    const { offset, size } = decodePage(request.page, 50, 200);
    const status =
      request.status === ApplicationStatus.APPLICATION_STATUS_UNSPECIFIED
        ? undefined
        : applicationStatus.toDb(request.status);
    const { rows, total } = await this.applications.list(this.database.db, status, offset, size);
    return { applications: rows.map(toApplication), page: encodePage(offset, rows.length, total) };
  }

  async getApplication(request: GetApplicationRequest, ctx: RequestContext): Promise<GetApplicationResponse> {
    this.access.requireOps(ctx);
    const row = await this.applications.find(this.database.db, request.applicationId);
    if (!row) throw applicationNotFound(request.applicationId);
    return { application: toApplication(row) };
  }

  async setApplicationDocumentStatus(
    request: SetApplicationDocumentStatusRequest,
    ctx: RequestContext,
  ): Promise<SetApplicationDocumentStatusResponse> {
    this.access.requireOps(ctx);
    const valid = [
      DocumentStatus.DOCUMENT_STATUS_PENDING,
      DocumentStatus.DOCUMENT_STATUS_APPROVED,
      DocumentStatus.DOCUMENT_STATUS_REJECTED,
    ];
    if (!valid.includes(request.status)) {
      throw invalidArgument("DOCUMENT_STATUS_INVALID", "Approve or reject the document.", {
        field: "status",
      });
    }
    const reason = request.rejectReason.trim();
    if (request.status === DocumentStatus.DOCUMENT_STATUS_REJECTED && !reason) {
      throw invalidArgument("REJECT_REASON_REQUIRED", "Say what's wrong so they can fix it.", {
        field: "reject_reason",
      });
    }
    const row = await this.database.transaction(ctx, async (tx) => {
      const app = await this.applications.lock(tx, request.applicationId);
      if (!app) throw applicationNotFound(request.applicationId);
      if (app.status === "approved" || app.status === "rejected") throw applicationDecided(app);
      const docs = app.documents.map(documentFromJson);
      const doc = docs.find((d) => d.id === request.documentId);
      if (!doc)
        throw notFound("DOCUMENT_NOT_FOUND", "That document isn't on this application.", {
          document_id: request.documentId,
        });
      doc.status = request.status;
      doc.rejectReason = request.status === DocumentStatus.DOCUMENT_STATUS_REJECTED ? reason : "";
      return this.applications.update(tx, app.id, { documents: docs.map(documentToJson) });
    });
    return { application: toApplication(row) };
  }

  async decideApplication(
    request: DecideApplicationRequest,
    ctx: RequestContext,
  ): Promise<DecideApplicationResponse> {
    this.access.requireOps(ctx);
    const decision = applicationStatus.toDb(request.decision);
    if (decision !== "approved" && decision !== "changes_requested" && decision !== "rejected") {
      throw invalidArgument("DECISION_INVALID", "Approve, request changes or reject.", { field: "decision" });
    }
    const note = request.note.trim();
    if (decision !== "approved" && !note) {
      throw invalidArgument("NOTE_REQUIRED", "Tell the applicant why.", { field: "note" });
    }
    const bps = request.commissionBps || DEFAULT_COMMISSION_BPS;
    if (!Number.isInteger(bps) || bps < 0 || bps > MAX_COMMISSION_BPS) {
      throw invalidArgument("COMMISSION_OUT_OF_RANGE", "Commission must be between 0% and 35%.", {
        field: "commission_bps",
      });
    }

    const response = await this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `DecideApplication:${request.applicationId}`,
          key: request.idempotencyKey,
          request: DecideApplicationRequest.encode(request).finish(),
          codec: DecideApplicationResponse,
        },
        () => this.decide(tx, request.applicationId, decision, note, bps, ctx),
      ),
    );
    // Catalog creates the restaurant (idempotent on restaurant_id). Outside the transaction so no lock
    // is held over the network; repeating an approval retries it.
    const app = response.application;
    if (app?.status === ApplicationStatus.APPLICATION_STATUS_APPROVED && app.outletId) {
      await this.createInCatalog(app.outletId, app.business, app.owner?.phone ?? "", ctx);
    }
    return response;
  }

  private async decide(
    tx: Tx,
    applicationId: string,
    decision: "approved" | "changes_requested" | "rejected",
    note: string,
    commissionBps: number,
    ctx: RequestContext,
  ): Promise<DecideApplicationResponse> {
    const app = await this.applications.lock(tx, applicationId);
    if (!app) throw applicationNotFound(applicationId);
    if (app.status === decision && (decision === "approved" || decision === "rejected")) {
      return { application: toApplication(app) }; // repeated decision: no-op
    }
    if (app.status === "approved" || app.status === "rejected") throw applicationDecided(app);

    const now = new Date();
    let docs = app.documents.map(documentFromJson);
    let outletId: string | null = null;
    if (decision === "approved") {
      if (docs.some((d) => d.status === DocumentStatus.DOCUMENT_STATUS_REJECTED)) {
        throw failedPrecondition(
          "DOCUMENTS_NOT_APPROVED",
          "Some documents were rejected. Request changes instead.",
        );
      }
      // Approving the application approves whatever is still pending (admin console behaviour).
      docs = docs.map((d): PartnerDocument =>
        d.status === DocumentStatus.DOCUMENT_STATUS_PENDING
          ? { ...d, status: DocumentStatus.DOCUMENT_STATUS_APPROVED }
          : d,
      );
      if (!allDocumentsApproved(docs)) {
        throw failedPrecondition("DOCUMENTS_NOT_APPROVED", "Approve every document first.");
      }
      outletId = app.id; // deterministic: a retried approval targets the same outlet/restaurant
      await this.createOutlet(tx, app, outletId, commissionBps, now);
    }
    const row = await this.applications.update(tx, app.id, {
      status: decision,
      decisionNote: note,
      decidedAt: now,
      documents: docs.map(documentToJson),
      outletId,
    });
    const application = toApplication(row);
    await this.events.applicationDecided(tx, {
      applicationId: app.id,
      application,
      actor: actorOf(ctx),
      occurredAt: now,
    });
    return { application };
  }

  private async createOutlet(
    tx: Tx,
    app: ApplicationRow,
    outletId: string,
    commissionBps: number,
    now: Date,
  ) {
    const business = BusinessDetails.fromJSON(app.business);
    const owner = OwnerDetails.fromJSON(app.owner);
    await this.outlets.insert(tx, {
      id: outletId,
      name: business.name,
      area: business.area || business.city,
      address: [business.address, business.city].filter(Boolean).join(", "),
      phone: app.ownerPhone,
      zoneId: app.zoneId,
      cuisine: business.cuisine,
      ownerName: owner.name,
      ownerPhone: app.ownerPhone,
      ownerEmail: owner.email,
      // New partners start closed until their menu is set up; ops opens them.
      adminStatus: "closed",
      adminStatusReason: "New partner: menu being set up",
      accepting: false,
      commissionBps,
      bank: app.bank,
      settings: settingsToJson(DEFAULT_SETTINGS),
      joinedAt: now,
    });
    // The owner joins the team as a pending member; they're linked when they first sign in.
    await this.staff.insert(tx, {
      id: uuidv7(),
      outletId,
      userId: null,
      name: owner.name,
      phone: app.ownerPhone,
      role: "owner",
      pending: true,
    });
  }

  private async createInCatalog(
    outletId: string,
    business: BusinessDetails | undefined,
    phone: string,
    ctx: RequestContext,
  ): Promise<void> {
    if (!this.catalog.configured || !business) {
      this.logger.warn(
        { outletId },
        "CATALOG_GRPC not set; catalog must create the restaurant from PartnerApplicationDecided",
      );
      return;
    }
    try {
      await this.catalog.createRestaurant(
        {
          restaurantId: outletId,
          idempotencyKey: `merchant:application:${outletId}:restaurant`,
          details: {
            name: business.name,
            kind: RestaurantKind.RESTAURANT_KIND_RESTAURANT,
            categoryId: "",
            cuisine: business.cuisine,
            imageId: "",
            priceLevel: 1,
            area: business.area || business.city,
            address: [business.address, business.city].filter(Boolean).join(", "),
            phone,
            location: business.location,
            prepMinMinutes: 15,
            prepMaxMinutes: 25,
          },
        },
        ctx,
      );
    } catch (err) {
      // The approval stands (outlet created, event published); approving again retries this call.
      this.logger.warn({ err, outletId }, "catalog.CreateRestaurant failed; approve again to retry");
    }
  }
}

interface Submission {
  phone: string;
  business: BusinessDetails;
  owner: OwnerDetails;
  documents: PartnerDocument[];
  bank: BankJson | null;
  bankAccountNumber: string | null;
  menu: MenuSubmission;
}

export function validateSubmission(request: SubmitApplicationRequest): Submission {
  const b = request.business;
  const o = request.owner;
  const name = b?.name.trim() ?? "";
  if (!b || !name)
    throw invalidArgument("BUSINESS_NAME_REQUIRED", "Enter your business name.", { field: "business.name" });
  if (name.length > 100)
    throw invalidArgument("BUSINESS_NAME_TOO_LONG", "Keep the name under 100 characters.", {
      field: "business.name",
    });
  if (b.type === BusinessType.BUSINESS_TYPE_UNSPECIFIED || b.type === BusinessType.UNRECOGNIZED) {
    throw invalidArgument("BUSINESS_TYPE_REQUIRED", "Choose what kind of business it is.", {
      field: "business.type",
    });
  }
  if (!b.address.trim())
    throw invalidArgument("ADDRESS_REQUIRED", "Enter the business address.", { field: "business.address" });
  if (!o || !o.name.trim())
    throw invalidArgument("OWNER_NAME_REQUIRED", "Enter the owner's name.", { field: "owner.name" });
  const phone = normalisePhone(o.phone, "owner.phone");
  const email = o.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw invalidArgument("EMAIL_INVALID", "Check the email address.", { field: "owner.email" });
  }

  const documents = request.documents
    .filter((d) => d.fileName.trim() || d.fileRef.trim())
    .map((d): PartnerDocument => ({
      ...d,
      id: uuidv7(),
      kind: d.kind.trim(),
      name: d.name.trim() || DOCUMENT_NAMES[d.kind.trim()] || d.kind.trim(),
      fileName: d.fileName.trim(),
      status: DocumentStatus.DOCUMENT_STATUS_PENDING,
      rejectReason: "",
    }));
  if (documents.length === 0) {
    throw invalidArgument(
      "DOCUMENTS_REQUIRED",
      "Upload your business registration and food safety certificate.",
      {
        field: "documents",
      },
    );
  }

  const accountNumber = (request.bank?.accountNumber ?? "").replace(/\s/g, "");
  if (accountNumber && !/^\d{6,20}$/.test(accountNumber)) {
    throw invalidArgument("ACCOUNT_NUMBER_INVALID", "Check the account number.", {
      field: "bank.account_number",
    });
  }
  const bank: BankJson | null = request.bank?.bank.trim()
    ? {
        bank: request.bank.bank.trim(),
        branch: request.bank.branch.trim(),
        accountName: request.bank.accountName.trim(),
        accountLast4: accountNumber.slice(-4) || request.bank.accountLast4,
      }
    : null;

  return {
    phone,
    business: {
      ...b,
      name,
      address: b.address.trim(),
      city: b.city.trim(),
      brNumber: b.brNumber.trim(),
      cuisine: b.cuisine.trim(),
      area: b.area.trim() || b.city.trim(),
    },
    owner: { name: o.name.trim(), phone, email, nic: o.nic.trim() },
    documents,
    bank,
    bankAccountNumber: accountNumber || null,
    menu: request.menu ?? {
      method: MenuSubmissionMethod.MENU_SUBMISSION_METHOD_LATER,
      fileName: "",
      fileRef: "",
    },
  };
}

function applicationNotFound(id: string) {
  return notFound("APPLICATION_NOT_FOUND", "We couldn't find that application.", { application_id: id });
}

function applicationDecided(app: ApplicationRow) {
  return failedPrecondition("APPLICATION_DECIDED", "This application has already been decided.", {
    status: app.status,
  });
}
