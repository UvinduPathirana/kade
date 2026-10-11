import { status } from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import { OrderDelivered, OrderRefunded } from "@kade/proto/kade/order/v1/order_events";
import { CustomerRegistered } from "@kade/proto/kade/profile/v1/profile_events";
import {
  AddFavouriteRequest,
  ChangeCreditRequest,
  CreditReason,
  EnsureCustomerRequest,
  FraudFlagKind,
  FraudFlagStatus,
  GetCreditAccountRequest,
  JoinPlusRequest,
  ListCustomersRequest,
  PlusPlan,
  PlusStatus,
  SaveAddressRequest,
  UpdatePreferencesRequest,
  UpdateProfileRequest,
  type ChangeCreditResponse,
} from "@kade/proto/kade/profile/v1/profile_service";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../../src/platform/db/database.js";
import type { EventContext } from "../../src/platform/kafka/event-handler.js";
import { RiskEventsConsumer } from "../../src/risk/order-events.consumer.js";
import { keycloakUserId, seedCustomerId } from "../../src/seed/demo-data.js";
import { as, config, eventually, grpcError, rpc, startHarness, testId, type Harness } from "./harness.js";

const DILINI = keycloakUserId(1);
const lkr = (amountMinor: number) => ({ amountMinor, currency: "LKR" });

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

/** A fresh customer, the way a gateway creates one on first request. */
async function newCustomer(fields: Partial<EnsureCustomerRequest> = {}): Promise<string> {
  const id = testId();
  await rpc(
    h.customers.ensureCustomer.bind(h.customers),
    EnsureCustomerRequest.fromPartial({ customerId: id, ...fields }),
    as(id),
  );
  return id;
}

const changeCredit = (req: Partial<ChangeCreditRequest>, md = as()): Promise<ChangeCreditResponse> =>
  rpc(h.credit.changeCredit.bind(h.credit), ChangeCreditRequest.fromPartial(req), md);

describe("demo seed", () => {
  it("gives Dilini (Keycloak sub …8005-000000000001) her profile, addresses, credit and favourites", async () => {
    const md = as(DILINI);
    const { customer } = await rpc(h.customers.getCustomer.bind(h.customers), { customerId: DILINI }, md);
    expect(customer).toMatchObject({ name: "Dilini Perera", email: "dilini@kade.test", area: "Kollupitiya" });

    const { addresses } = await rpc(h.addresses.listAddresses.bind(h.addresses), { customerId: DILINI }, md);
    const lines = addresses.map((a) => a.line);
    expect(lines).toEqual(
      expect.arrayContaining(["42 Galle Rd, Colombo 03", "18 Bauddhaloka Mawatha, Colombo 07"]),
    );
    expect(addresses.find((a) => a.label === "Home")).toMatchObject({ zoneId: "c03", area: "Kollupitiya" });

    const { account } = await rpc(
      h.credit.getCreditAccount.bind(h.credit),
      GetCreditAccountRequest.fromPartial({ customerId: DILINI }),
      md,
    );
    expect(account!.history.some((e) => e.reason === CreditReason.CREDIT_REASON_REFERRAL)).toBe(true);
    expect(account!.history.find((e) => e.reason === CreditReason.CREDIT_REASON_REFERRAL)?.amount).toEqual(
      lkr(50_000),
    );

    const { favourites } = await rpc(
      h.favourites.listFavourites.bind(h.favourites),
      { customerId: DILINI },
      md,
    );
    expect(favourites.map((f) => f.restaurantId)).toEqual(
      expect.arrayContaining([
        "00000000-0000-7000-8000-000000000002",
        "00000000-0000-7000-8000-000000000012",
      ]),
    );
  });

  it("seeds the admin console's customers with stats, flags and a blocked account", async () => {
    const { customers, page } = await rpc(
      h.customers.listCustomers.bind(h.customers),
      ListCustomersRequest.fromPartial({ page: { pageSize: 100 } }),
      as("staff-1", "ops"),
    );
    expect(page!.totalSize).toBeGreaterThanOrEqual(37);
    expect(customers.length).toBeGreaterThanOrEqual(37);
    const flagged = await rpc(
      h.customers.listCustomers.bind(h.customers),
      ListCustomersRequest.fromPartial({ flaggedOnly: true }),
      as("staff-1", "ops"),
    );
    expect(flagged.customers.every((c) => c.openFlags > 0)).toBe(true);
    const blocked = await rpc(
      h.customers.listCustomers.bind(h.customers),
      ListCustomersRequest.fromPartial({ blockedOnly: true }),
      as("staff-1", "ops"),
    );
    expect(blocked.customers.map((c) => c.customer!.id)).toContain(seedCustomerId(2040 + 30 * 7));
    const search = await rpc(
      h.customers.listCustomers.bind(h.customers),
      ListCustomersRequest.fromPartial({ query: "Shehani" }),
      as("staff-1", "ops"),
    );
    expect(search.customers[0]?.customer).toMatchObject({
      id: seedCustomerId(2040),
      name: "Shehani Wijeratne",
    });
    expect(search.customers[0]?.stats?.ordersCount).toBeGreaterThan(0);
  });
});

describe("EnsureCustomer and the profile", () => {
  it("creates on first call (CustomerRegistered in the outbox), then fills blanks only", async () => {
    const id = testId();
    const md = as(id);
    const first = await rpc(
      h.customers.ensureCustomer.bind(h.customers),
      EnsureCustomerRequest.fromPartial({ customerId: id, phone: "077 123 4567" }),
      md,
    );
    expect(first.isNew).toBe(true);
    expect(first.customer).toMatchObject({ id, phone: "+94771234567", name: "", plusActive: false });

    const { rows } = await h.pool.query("select type, payload from outbox where aggregateid = $1", [id]);
    expect(rows.map((r) => r.type)).toEqual(["kade.profile.v1.CustomerRegistered"]);
    expect(CustomerRegistered.decode(rows[0].payload).customerId).toBe(id);

    // Still no name: the app keeps asking for it.
    const again = await rpc(
      h.customers.ensureCustomer.bind(h.customers),
      EnsureCustomerRequest.fromPartial({ customerId: id, name: "Asha", email: "asha@example.com" }),
      md,
    );
    expect(again).toMatchObject({ isNew: false, customer: { name: "Asha", email: "asha@example.com" } });

    await rpc(
      h.customers.updateProfile.bind(h.customers),
      UpdateProfileRequest.fromPartial({ customerId: id, name: "Asha Perera", email: "" }),
      md,
    );
    const third = await rpc(
      h.customers.ensureCustomer.bind(h.customers),
      EnsureCustomerRequest.fromPartial({ customerId: id, name: "Token Name", email: "token@example.com" }),
      md,
    );
    // Name is kept (customer edited it); the cleared email is filled again from the token.
    expect(third.customer).toMatchObject({ name: "Asha Perera", email: "token@example.com" });
    expect(third.isNew).toBe(false);
  });

  it("ignores the placeholder name/email of phone-only Keycloak accounts", async () => {
    const id = testId();
    const res = await rpc(
      h.customers.ensureCustomer.bind(h.customers),
      EnsureCustomerRequest.fromPartial({
        customerId: id,
        name: "Kade Customer",
        email: "94770000000@phone.kade.test",
      }),
      as(id),
    );
    expect(res).toMatchObject({ isNew: true, customer: { name: "", email: "" } });
  });

  it("keeps customers out of each other's accounts; staff and internal callers may read any", async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    expect(await grpcError(rpc(h.customers.getCustomer.bind(h.customers), { customerId: b }, as(a)))).toEqual(
      {
        code: status.PERMISSION_DENIED,
        reason: "NOT_YOUR_ACCOUNT",
      },
    );
    await rpc(h.customers.getCustomer.bind(h.customers), { customerId: b }, as("someone", "support"));
    await rpc(h.customers.getCustomer.bind(h.customers), { customerId: b }, as());
    expect(
      await grpcError(rpc(h.customers.getCustomer.bind(h.customers), { customerId: uuidv7() }, as())),
    ).toEqual({ code: status.NOT_FOUND, reason: "CUSTOMER_NOT_FOUND" });
  });

  it("stores preferences and rejects unknown languages", async () => {
    const id = await newCustomer();
    const md = as(id);
    const { preferences } = await rpc(h.customers.getPreferences.bind(h.customers), { customerId: id }, md);
    expect(preferences).toMatchObject({ orderUpdatesPush: true, marketingSms: false, language: "en" });
    const saved = await rpc(
      h.customers.updatePreferences.bind(h.customers),
      UpdatePreferencesRequest.fromPartial({
        customerId: id,
        preferences: { ...preferences!, vegetarian: true, language: "si" },
      }),
      md,
    );
    expect(saved.preferences).toMatchObject({ vegetarian: true, language: "si" });
    expect(
      await grpcError(
        rpc(
          h.customers.updatePreferences.bind(h.customers),
          UpdatePreferencesRequest.fromPartial({ customerId: id, preferences: { language: "fr" } }),
          md,
        ),
      ),
    ).toEqual({ code: status.INVALID_ARGUMENT, reason: "LANGUAGE_UNSUPPORTED" });
  });
});

describe("addresses and favourites", () => {
  it("adds, replaces, lists and removes saved addresses, keeping the area in step", async () => {
    const id = await newCustomer();
    const md = as(id);
    const save = (address: Partial<SaveAddressRequest["address"]>) =>
      rpc(
        h.addresses.saveAddress.bind(h.addresses),
        SaveAddressRequest.fromPartial({ customerId: id, address }),
        md,
      );

    const { address: work } = await save({ label: "Work", line: "1 Main St", area: "Fort", zoneId: "c01" });
    expect(work!.id).toMatch(/^[0-9a-f-]{36}$/);
    const { address: home } = await save({
      id: "home",
      label: "Home",
      line: "42 Galle Rd, Colombo 03",
      area: "Kollupitiya",
      location: { lat: 6.9114, lng: 79.8496 },
    });
    expect(home).toMatchObject({ id: "home", location: { lat: 6.9114, lng: 79.8496 } });
    await save({ id: "home", label: "Home", line: "44 Galle Rd, Colombo 03", area: "Kollupitiya" });

    const { addresses } = await rpc(h.addresses.listAddresses.bind(h.addresses), { customerId: id }, md);
    expect(addresses.map((a) => a.line)).toEqual(["1 Main St", "44 Galle Rd, Colombo 03"]);
    const { customer } = await rpc(h.customers.getCustomer.bind(h.customers), { customerId: id }, md);
    expect(customer!.area).toBe("Kollupitiya");

    await rpc(h.addresses.removeAddress.bind(h.addresses), { customerId: id, addressId: "home" }, md);
    await rpc(h.addresses.removeAddress.bind(h.addresses), { customerId: id, addressId: "home" }, md);
    const after = await rpc(h.addresses.listAddresses.bind(h.addresses), { customerId: id }, md);
    expect(after.addresses.map((a) => a.id)).toEqual([work!.id]);

    expect(await grpcError(save({ label: "", line: "x" }))).toEqual({
      code: status.INVALID_ARGUMENT,
      reason: "ADDRESS_LABEL_REQUIRED",
    });
    await rpc(
      h.addresses.joinWaitlist.bind(h.addresses),
      { customerId: id, placeId: "kandy", placeName: "Kandy", area: "Kandy", location: undefined },
      md,
    );
  });

  it("adds and removes favourites idempotently", async () => {
    const id = await newCustomer();
    const md = as(id);
    const add = () =>
      rpc(
        h.favourites.addFavourite.bind(h.favourites),
        AddFavouriteRequest.fromPartial({
          customerId: id,
          restaurantId: "00000000-0000-7000-8000-000000000003",
        }),
        md,
      );
    const first = await add();
    const second = await add();
    expect(second.favourite).toEqual(first.favourite);
    expect(
      (await rpc(h.favourites.listFavourites.bind(h.favourites), { customerId: id }, md)).favourites,
    ).toHaveLength(1);
    const remove = () =>
      rpc(
        h.favourites.removeFavourite.bind(h.favourites),
        { customerId: id, restaurantId: "00000000-0000-7000-8000-000000000003" },
        md,
      );
    await remove();
    await remove();
    expect(
      (await rpc(h.favourites.listFavourites.bind(h.favourites), { customerId: id }, md)).favourites,
    ).toHaveLength(0);
  });
});

describe("Kadé credit", () => {
  it("adds, spends idempotently, refuses overdrafts and reverses exactly what an order spent", async () => {
    const id = await newCustomer();
    const orderId = uuidv7();
    const staff = as("staff-1", "support");

    const goodwill = await changeCredit(
      {
        customerId: id,
        amount: lkr(80_000),
        reason: CreditReason.CREDIT_REASON_GOODWILL,
        by: "Ruwani",
        label: "Late",
      },
      staff,
    );
    expect(goodwill.balance).toEqual(lkr(80_000));

    // The saga spends with the customer's identity forwarded, or none at all; either works.
    const spendReq = {
      customerId: id,
      amount: lkr(-50_000),
      reason: CreditReason.CREDIT_REASON_ORDER_SPEND,
      orderId,
      label: "Used on order KD-1",
      idempotencyKey: `order:${orderId}:credit`,
    };
    const spend = await changeCredit(spendReq, as(id));
    const retry = await changeCredit(spendReq);
    expect(retry).toEqual(spend);
    expect(spend.balance).toEqual(lkr(30_000));

    expect(
      await grpcError(
        changeCredit({
          ...spendReq,
          amount: lkr(-40_000),
          idempotencyKey: `order:${uuidv7()}:credit`,
          orderId: uuidv7(),
        }),
      ),
    ).toEqual({ code: status.FAILED_PRECONDITION, reason: "CREDIT_INSUFFICIENT" });

    // Reversal asks for more than was spent: only the spend comes back.
    const reverseReq = {
      customerId: id,
      amount: lkr(90_000),
      reason: CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED,
      orderId,
      idempotencyKey: `order:${orderId}:credit:reverse`,
    };
    const reversed = await changeCredit(reverseReq);
    expect(reversed.entry?.amount).toEqual(lkr(50_000));
    expect(reversed.balance).toEqual(lkr(80_000));
    expect(await changeCredit(reverseReq)).toEqual(reversed);
    // A second, different reversal finds nothing left to return.
    const nothing = await changeCredit({ ...reverseReq, idempotencyKey: "another-key" });
    expect(nothing.entry).toBeUndefined();
    expect(nothing.balance).toEqual(lkr(80_000));
    // A spend that lands after its compensation is refused.
    expect(await grpcError(changeCredit({ ...spendReq, idempotencyKey: "late-spend" }))).toEqual({
      code: status.FAILED_PRECONDITION,
      reason: "ORDER_CREDIT_REVERSED",
    });

    // History, newest first, with the running balance.
    const { account, page } = await rpc(
      h.credit.getCreditAccount.bind(h.credit),
      GetCreditAccountRequest.fromPartial({ customerId: id, page: { pageSize: 2 } }),
      as(id),
    );
    expect(account!.balance).toEqual(lkr(80_000));
    expect(account!.history.map((e) => e.reason)).toEqual([
      CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED,
      CreditReason.CREDIT_REASON_ORDER_SPEND,
    ]);
    expect(page).toMatchObject({ totalSize: 3 });
    expect(page!.nextPageToken).not.toBe("");

    // Every movement is a CustomerCreditChanged event for ledger.
    const { rows } = await h.pool.query(
      "select count(*)::int as n from outbox where aggregateid = $1 and type = 'kade.profile.v1.CustomerCreditChanged'",
      [id],
    );
    expect(rows[0].n).toBe(3);
  });

  it("never lets concurrent spends overdraw", async () => {
    const id = await newCustomer();
    await changeCredit({ customerId: id, amount: lkr(10_000), reason: CreditReason.CREDIT_REASON_GOODWILL });
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map(() =>
        changeCredit({
          customerId: id,
          amount: lkr(-4_000),
          reason: CreditReason.CREDIT_REASON_ORDER_SPEND,
          orderId: uuidv7(),
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const { account } = await rpc(
      h.credit.getCreditAccount.bind(h.credit),
      GetCreditAccountRequest.fromPartial({ customerId: id }),
      as(),
    );
    expect(account!.balance).toEqual(lkr(2_000));
  });

  it("doesn't let customers give themselves credit", async () => {
    const id = await newCustomer();
    expect(
      await grpcError(
        changeCredit(
          { customerId: id, amount: lkr(100), reason: CreditReason.CREDIT_REASON_GOODWILL },
          as(id),
        ),
      ),
    ).toEqual({ code: status.PERMISSION_DENIED, reason: "PERMISSION_DENIED" });
  });
});

describe("Kadé Plus", () => {
  it("joins with a free month, refuses a second join, and cancels to the end of the period", async () => {
    const id = await newCustomer();
    const md = as(id);
    const join = (key: string) =>
      rpc(
        h.plus.joinPlus.bind(h.plus),
        JoinPlusRequest.fromPartial({
          customerId: id,
          plan: PlusPlan.PLUS_PLAN_MONTHLY,
          cardId: "visa-4242",
          idempotencyKey: key,
        }),
        md,
      );
    const { membership } = await join("k1");
    expect(membership).toMatchObject({
      status: PlusStatus.PLUS_STATUS_MEMBER,
      cardLabel: "Visa •••• 4242",
      active: true,
      price: lkr(99_000),
    });
    expect(membership!.trialEndsAt!.getTime() - membership!.joinedAt!.getTime()).toBe(30 * 86_400_000);
    expect((await join("k1")).membership).toEqual(membership); // idempotent retry
    expect(await grpcError(join("k2"))).toEqual({
      code: status.FAILED_PRECONDITION,
      reason: "PLUS_ALREADY_MEMBER",
    });

    const { customer } = await rpc(h.customers.getCustomer.bind(h.customers), { customerId: id }, md);
    expect(customer!.plusActive).toBe(true);

    const cancelled = await rpc(h.plus.cancelPlus.bind(h.plus), { customerId: id }, md);
    expect(cancelled.membership).toMatchObject({ status: PlusStatus.PLUS_STATUS_CANCELLED, active: true });
    expect(cancelled.membership!.endsAt).toEqual(membership!.trialEndsAt);
    expect(await grpcError(rpc(h.plus.cancelPlus.bind(h.plus), { customerId: id }, md))).toEqual({
      code: status.FAILED_PRECONDITION,
      reason: "PLUS_NOT_MEMBER",
    });
  });
});

describe("admin: detail, block, flags", () => {
  it("blocks and unblocks with a reason, actioning open flags", async () => {
    const id = await newCustomer({ name: "Risky Rohan" });
    const ops = as("ops-1", "ops");
    expect(
      await grpcError(
        rpc(
          h.customers.setCustomerBlocked.bind(h.customers),
          { customerId: id, blocked: true, reason: "" },
          ops,
        ),
      ),
    ).toEqual({ code: status.INVALID_ARGUMENT, reason: "BLOCK_REASON_REQUIRED" });
    expect(
      await grpcError(
        rpc(
          h.customers.setCustomerBlocked.bind(h.customers),
          { customerId: id, blocked: true, reason: "x" },
          as(id),
        ),
      ),
    ).toEqual({ code: status.PERMISSION_DENIED, reason: "PERMISSION_DENIED" });

    const blocked = await rpc(
      h.customers.setCustomerBlocked.bind(h.customers),
      { customerId: id, blocked: true, reason: "Voucher abuse" },
      ops,
    );
    expect(blocked.customer).toMatchObject({ blocked: true, blockReason: "Voucher abuse" });
    const unblocked = await rpc(
      h.customers.setCustomerBlocked.bind(h.customers),
      { customerId: id, blocked: false, reason: "Appeal accepted" },
      ops,
    );
    expect(unblocked.customer).toMatchObject({ blocked: false, blockReason: "" });
    const { rows } = await h.pool.query(
      "select count(*)::int as n from outbox where aggregateid = $1 and type = 'kade.profile.v1.CustomerBlockChanged'",
      [id],
    );
    expect(rows[0].n).toBe(2);
  });

  it("raises flags from refunds (consumer rules), shows them in the detail and resolves them", async () => {
    const id = await newCustomer({ name: "Refund Ranjith" });
    const consumer = h.app.get(RiskEventsConsumer);
    const database = h.app.get(Database);
    const deliver = (eventId: string, ev: (ctx: EventContext) => Promise<void>) =>
      database.transaction(undefined, (tx) =>
        ev({ tx, eventId, eventType: "", topic: "", partition: 0, offset: "0", key: id, attempt: 1 }),
      );

    await deliver(uuidv7(), (ctx) =>
      consumer.orderDelivered(
        OrderDelivered.fromPartial({
          orderId: uuidv7(),
          order: { customer: { id }, totals: { total: lkr(245_000) } },
          occurredAt: new Date(),
        }),
        ctx,
      ),
    );
    for (let i = 0; i < 3; i++) {
      await deliver(uuidv7(), (ctx) =>
        consumer.orderRefunded(
          OrderRefunded.fromPartial({
            orderId: uuidv7(),
            refund: { customerId: id, amount: lkr(1_000_00) },
            occurredAt: new Date(),
          }),
          ctx,
        ),
      );
    }

    const staff = as("support-1", "support");
    const detail = await rpc(h.customers.getCustomerDetail.bind(h.customers), { customerId: id }, staff);
    expect(detail.stats).toMatchObject({ ordersCount: 1, spend: lkr(245_000) });
    expect(detail.flags).toHaveLength(1);
    expect(detail.flags[0]).toMatchObject({
      kind: FraudFlagKind.FRAUD_FLAG_KIND_REFUNDS,
      status: FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN,
      detail: "3 refunds in 7 days, Rs 3,000 refunded",
    });

    const { flag } = await rpc(
      h.customers.resolveFraudFlag.bind(h.customers),
      {
        customerId: id,
        flagId: detail.flags[0]!.id,
        status: FraudFlagStatus.FRAUD_FLAG_STATUS_CLEARED,
        resolution: "Checked with the restaurant",
      },
      staff,
    );
    expect(flag).toMatchObject({ status: FraudFlagStatus.FRAUD_FLAG_STATUS_CLEARED });
    expect(flag!.resolution).toMatch(/^Checked with the restaurant\. Cleared by /);
    expect(
      await grpcError(
        rpc(
          h.customers.resolveFraudFlag.bind(h.customers),
          {
            customerId: id,
            flagId: flag!.id,
            status: FraudFlagStatus.FRAUD_FLAG_STATUS_ACTIONED,
            resolution: "",
          },
          staff,
        ),
      ),
    ).toEqual({ code: status.FAILED_PRECONDITION, reason: "FLAG_ALREADY_RESOLVED" });
  });
});

describe("outbox -> Debezium -> kade.customer.events", () => {
  it("publishes CustomerRegistered keyed by customer id", async () => {
    const kafka = new KafkaJS.Kafka({
      kafkaJS: { brokers: config.KAFKA_BROKERS, logLevel: KafkaJS.logLevel.ERROR },
    });
    const consumer = kafka.consumer({ kafkaJS: { groupId: `profile-it-${uuidv7()}`, fromBeginning: true } });
    await consumer.connect();
    await consumer.subscribe({ topics: ["kade.customer.events"] });
    const id = testId();
    const seen = new Promise<{ type: string; key: string }>((resolve) => {
      void consumer.run({
        eachMessage: async ({ message }) => {
          if (message.key?.toString() === id) {
            resolve({ type: message.headers?.eventType?.toString() ?? "", key: id });
          }
        },
      });
    });
    try {
      await rpc(
        h.customers.ensureCustomer.bind(h.customers),
        EnsureCustomerRequest.fromPartial({ customerId: id }),
        as(id),
      );
      const got = await Promise.race([seen, eventually(async () => undefined, 45_000) as Promise<never>]);
      expect(got.type).toBe("kade.profile.v1.CustomerRegistered");
    } finally {
      await consumer.disconnect();
    }
  });
});
