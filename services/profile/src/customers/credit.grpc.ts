import { Inject, Injectable } from "@nestjs/common";
import {
  ChangeCreditRequest,
  ChangeCreditResponse,
  CreditServiceService,
  type GetCreditAccountRequest,
  type GetCreditAccountResponse,
} from "@kade/proto/kade/profile/v1/profile_service";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument, permissionDenied } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { assertCustomerAccess, isInternal, isStaff, requireCustomerId } from "../shared/access.js";
import { lkr, readMoney } from "../shared/money.js";
import { pageResponse, readPage } from "../shared/paging.js";
import { CUSTOMER_SELF_REASONS, validateCreditChange } from "./credit-rules.js";
import { creditEntryToProto, ProfileStore } from "./profile-store.js";

/** kade.profile.v1.CreditService: the Kadé credit wallet (profile is the system of record). */
@GrpcService(CreditServiceService)
@Injectable()
export class CreditGrpcService implements GrpcHandlers<CreditServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ProfileStore) private readonly store: ProfileStore,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
  ) {}

  async getCreditAccount(
    request: GetCreditAccountRequest,
    ctx: RequestContext,
  ): Promise<GetCreditAccountResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const page = readPage(request.page, 20, 100);
    const db = this.database.db;
    const customer = await this.store.find(db, id);
    if (!customer) {
      // Not seen yet: an empty wallet, not an error (the app shows Rs 0).
      return {
        account: { customerId: id, balance: lkr(0), history: [] },
        page: pageResponse(page, 0, 0),
      };
    }
    const { rows, total } = await this.store.creditHistory(db, id, page.limit, page.offset);
    return {
      account: {
        customerId: id,
        balance: lkr(customer.creditBalanceMinor),
        history: rows.map(creditEntryToProto),
      },
      page: pageResponse(page, rows.length, total),
    };
  }

  /**
   * Idempotent on idempotency_key (scope: customer). The saga spends with "order:<id>:credit" and
   * compensates with "order:<id>:credit:reverse" (reason ORDER_SPEND_REVERSED, positive amount).
   */
  async changeCredit(request: ChangeCreditRequest, ctx: RequestContext): Promise<ChangeCreditResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const amountMinor = readMoney(request.amount, "amount");
    if (amountMinor === undefined) {
      throw invalidArgument("AMOUNT_REQUIRED", "amount is required.", { field: "amount" });
    }
    const orderId = request.orderId.trim();
    validateCreditChange({ amountMinor, reason: request.reason, orderId });
    // Customers may spend their own credit (checkout) but never give themselves any.
    if (!isInternal(ctx) && !isStaff(ctx) && !CUSTOMER_SELF_REASONS.has(request.reason)) {
      throw permissionDenied("PERMISSION_DENIED", "Only Kadé staff can add credit.");
    }

    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `ChangeCredit:${id}`,
          key: request.idempotencyKey.trim(),
          request: ChangeCreditRequest.encode(request).finish(),
          codec: ChangeCreditResponse,
        },
        async () => {
          const { entry, balanceMinor } = await this.store.changeCredit(tx, {
            customerId: id,
            amountMinor,
            reason: request.reason,
            label: request.label,
            orderId,
            ticketId: request.ticketId.trim(),
            by: request.by.trim(),
          });
          return { entry: entry ? creditEntryToProto(entry) : undefined, balance: lkr(balanceMinor) };
        },
      ),
    );
  }
}
