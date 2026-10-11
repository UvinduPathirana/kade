import type { EnsureCustomerResponse } from "@kade/proto/kade/profile/v1/profile_service";
import type { Identity } from "./auth.js";
import { unary, type CallContext } from "./grpc/call.js";
import type { Upstreams } from "./grpc/clients.js";
import { e164Phone } from "./mappers/account.js";

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 10_000;
const RETRY_AFTER_FAILURE_MS = 30_000;

/**
 * Any Keycloak user is a customer: the first authenticated request creates their profile
 * (profile.EnsureCustomer is idempotent on customer_id = sub). Remembered per replica for a few
 * minutes so we don't upsert on every request; profile stays the source of truth.
 */
export class CustomerEnsurer {
  private readonly seen = new Map<string, number>();

  constructor(private readonly up: Pick<Upstreams, "customer">) {}

  ensure(identity: Identity, ctx: CallContext): Promise<EnsureCustomerResponse> {
    return unary(
      this.up.customer.ensureCustomer.bind(this.up.customer),
      {
        customerId: identity.userId,
        phone: identity.phone ? e164Phone(identity.phone) || identity.phone : "",
        name: identity.name ?? "",
        email: identity.email ?? "",
        referralCode: "",
      },
      ctx,
    ).then((res) => {
      this.remember(identity.userId);
      return res;
    });
  }

  /** Ensures at most once per TTL; after a failure, waits a little before trying again. */
  async ensureCached(identity: Identity, ctx: CallContext): Promise<void> {
    const until = this.seen.get(identity.userId);
    if (until && until > Date.now()) return;
    try {
      await this.ensure(identity, ctx);
    } catch (err) {
      this.remember(identity.userId, RETRY_AFTER_FAILURE_MS);
      throw err;
    }
  }

  private remember(userId: string, ttl = TTL_MS): void {
    if (this.seen.size >= MAX_ENTRIES) this.seen.clear();
    this.seen.set(userId, Date.now() + ttl);
  }
}
