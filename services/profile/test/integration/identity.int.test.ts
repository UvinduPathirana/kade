import { status } from "@grpc/grpc-js";
import {
  AuditRecordType,
  InviteStaffRequest,
  ListAuditEntriesRequest,
  RecordAuditRequest,
  SignInApp,
  StaffRole,
  StaffStatus,
} from "@kade/proto/kade/identity/v1/identity_service";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keycloakUserId, seedStaffId } from "../../src/seed/demo-data.js";
import { as, config, grpcError, rpc, startHarness, testId, type Harness } from "./harness.js";

let h: Harness;
const createdKeycloakUsers: string[] = [];

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  // Keep the shared realm clean: remove the phone users these tests created.
  if (createdKeycloakUsers.length) {
    const base = config.KEYCLOAK_URL!;
    const tokenRes = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: "admin",
        password: "admin",
      }),
    });
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    for (const id of createdKeycloakUsers) {
      await fetch(`${base}/admin/realms/kade/users/${id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${access_token}` },
      });
    }
  }
  await h?.close();
});

/** A random, valid Sri Lankan mobile number no other test uses. */
const randomPhone = () => `+9477${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;

describe("phone sign-in (dev OTP)", () => {
  it("verifies the dev code, provisions the Keycloak user, returns tokens and creates the customer", async () => {
    const phone = randomPhone();
    const start = await rpc(h.phone.startPhoneSignIn.bind(h.phone), {
      phone,
      app: SignInApp.SIGN_IN_APP_CUSTOMER,
    });
    expect(start.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(start.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

    // Resend too early is rate limited.
    expect(
      await grpcError(
        rpc(h.phone.startPhoneSignIn.bind(h.phone), { phone, app: SignInApp.SIGN_IN_APP_CUSTOMER }),
      ),
    ).toEqual({ code: status.RESOURCE_EXHAUSTED, reason: "OTP_RATE_LIMITED" });

    expect(
      await grpcError(
        rpc(h.phone.verifyPhoneSignIn.bind(h.phone), { challengeId: start.challengeId, code: "000000" }),
      ),
    ).toEqual({ code: status.INVALID_ARGUMENT, reason: "OTP_INVALID" });

    const verified = await rpc(h.phone.verifyPhoneSignIn.bind(h.phone), {
      challengeId: start.challengeId,
      code: "123 456",
    });
    createdKeycloakUsers.push(verified.userId);
    h.cleanupIds.push(verified.userId);
    expect(verified.isNew).toBe(true);
    expect(verified.tokens?.accessToken).toBeTruthy();
    expect(verified.tokens?.refreshToken).toBeTruthy();
    const claims = JSON.parse(
      Buffer.from(verified.tokens!.accessToken.split(".")[1]!, "base64url").toString(),
    ) as {
      sub: string;
      azp: string;
      iss: string;
    };
    expect(claims).toMatchObject({
      sub: verified.userId,
      azp: "customer-app",
      iss: "http://localhost:8080/realms/kade",
    });

    const { customer } = await rpc(
      h.customers.getCustomer.bind(h.customers),
      { customerId: verified.userId },
      as(verified.userId),
    );
    expect(customer).toMatchObject({ phone, name: "" });

    // A used code can't be used again.
    expect(
      await grpcError(
        rpc(h.phone.verifyPhoneSignIn.bind(h.phone), { challengeId: start.challengeId, code: "123456" }),
      ),
    ).toEqual({ code: status.FAILED_PRECONDITION, reason: "OTP_EXPIRED" });
  });

  it("rejects numbers that aren't Sri Lankan mobiles", async () => {
    expect(
      await grpcError(
        rpc(h.phone.startPhoneSignIn.bind(h.phone), {
          phone: "011 234 5678",
          app: SignInApp.SIGN_IN_APP_CUSTOMER,
        }),
      ),
    ).toEqual({ code: status.INVALID_ARGUMENT, reason: "PHONE_INVALID" });
  });

  it("locks a challenge after five wrong codes", async () => {
    const start = await rpc(h.phone.startPhoneSignIn.bind(h.phone), {
      phone: randomPhone(),
      app: SignInApp.SIGN_IN_APP_RIDER,
    });
    for (let i = 0; i < 5; i++) {
      await grpcError(
        rpc(h.phone.verifyPhoneSignIn.bind(h.phone), { challengeId: start.challengeId, code: "111111" }),
      );
    }
    expect(
      await grpcError(
        rpc(h.phone.verifyPhoneSignIn.bind(h.phone), { challengeId: start.challengeId, code: "123456" }),
      ),
    ).toEqual({ code: status.RESOURCE_EXHAUSTED, reason: "OTP_RATE_LIMITED" });
  });
});

describe("staff", () => {
  const admin = () => as(keycloakUserId(8), "admin,ops,finance,support");

  it("lists the seeded team including the Keycloak demo staff", async () => {
    const { staff } = await rpc(h.staff.listStaff.bind(h.staff), {}, as(keycloakUserId(5), "ops"));
    const ids = staff.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([keycloakUserId(8), keycloakUserId(5), seedStaffId(1)]));
    expect(staff.find((s) => s.id === seedStaffId(8))?.status).toBe(StaffStatus.STAFF_STATUS_INVITED);
    expect(await grpcError(rpc(h.staff.listStaff.bind(h.staff), {}, as(uuidv7(), "customer")))).toEqual({
      code: status.PERMISSION_DENIED,
      reason: "PERMISSION_DENIED",
    });
  });

  it("invites, changes the role of and removes a staff member (admins only)", async () => {
    const email = `it-${uuidv7().slice(-12)}@kade.lk`;
    const invite = (md = admin()) =>
      rpc(
        h.staff.inviteStaff.bind(h.staff),
        InviteStaffRequest.fromPartial({ name: "Test Person", email, role: StaffRole.STAFF_ROLE_SUPPORT }),
        md,
      );
    expect(await grpcError(invite(as(keycloakUserId(5), "ops")))).toEqual({
      code: status.PERMISSION_DENIED,
      reason: "PERMISSION_DENIED",
    });
    const { staff } = await invite();
    expect(staff).toMatchObject({ email, status: StaffStatus.STAFF_STATUS_INVITED, title: "Support" });
    expect(await grpcError(invite())).toEqual({ code: status.ALREADY_EXISTS, reason: "STAFF_EXISTS" });
    expect(
      await grpcError(
        rpc(
          h.staff.inviteStaff.bind(h.staff),
          InviteStaffRequest.fromPartial({ name: "X", email: "x@gmail.com", role: StaffRole.STAFF_ROLE_OPS }),
          admin(),
        ),
      ),
    ).toEqual({ code: status.INVALID_ARGUMENT, reason: "STAFF_EMAIL_INVALID" });

    const changed = await rpc(
      h.staff.changeStaffRole.bind(h.staff),
      { staffId: staff!.id, role: StaffRole.STAFF_ROLE_ADMIN },
      admin(),
    );
    expect(changed.staff?.role).toBe(StaffRole.STAFF_ROLE_ADMIN);
    await rpc(h.staff.removeStaff.bind(h.staff), { staffId: staff!.id }, admin());
    expect(await grpcError(rpc(h.staff.removeStaff.bind(h.staff), { staffId: staff!.id }, admin()))).toEqual({
      code: status.NOT_FOUND,
      reason: "STAFF_NOT_FOUND",
    });
  });

  it("returns and saves the permission matrix (admin keeps everything)", async () => {
    const before = await rpc(h.staff.getPermissionMatrix.bind(h.staff), {}, admin());
    expect(before.permissions).toHaveLength(16);
    const support = before.matrix.find((m) => m.role === StaffRole.STAFF_ROLE_SUPPORT)!;
    expect(support.permissionIds).toEqual(["orders.view", "orders.refundSmall", "customers.credit"]);
    const saved = await rpc(
      h.staff.savePermissionMatrix.bind(h.staff),
      {
        matrix: [
          {
            role: StaffRole.STAFF_ROLE_SUPPORT,
            permissionIds: [...support.permissionIds, "customers.block"],
          },
          { role: StaffRole.STAFF_ROLE_ADMIN, permissionIds: [] },
        ],
      },
      admin(),
    );
    expect(saved.matrix.find((m) => m.role === StaffRole.STAFF_ROLE_SUPPORT)?.permissionIds).toContain(
      "customers.block",
    );
    expect(saved.matrix.find((m) => m.role === StaffRole.STAFF_ROLE_ADMIN)?.permissionIds).toHaveLength(16);
    // Put the demo matrix back.
    await rpc(h.staff.savePermissionMatrix.bind(h.staff), { matrix: [support] }, admin());
    expect(
      await grpcError(
        rpc(
          h.staff.savePermissionMatrix.bind(h.staff),
          { matrix: [{ role: StaffRole.STAFF_ROLE_OPS, permissionIds: ["nope"] }] },
          admin(),
        ),
      ),
    ).toEqual({ code: status.INVALID_ARGUMENT, reason: "PERMISSION_UNKNOWN" });
  });
});

describe("audit", () => {
  it("records entries idempotently with the caller as actor and lists them newest first", async () => {
    const ops = as(keycloakUserId(5), "ops");
    const recordId = testId();
    const req = RecordAuditRequest.fromPartial({
      action: "Issued Rs 300 Kadé credit",
      recordType: AuditRecordType.AUDIT_RECORD_TYPE_CUSTOMER,
      recordId,
      detail: "Late delivery",
      idempotencyKey: `audit-${recordId}`,
    });
    const first = await rpc(h.audit.recordAudit.bind(h.audit), req, ops);
    expect(first.entry).toMatchObject({
      actorName: "Ops Desk",
      actor: { userId: keycloakUserId(5), roles: ["ops"] },
    });
    expect((await rpc(h.audit.recordAudit.bind(h.audit), req, ops)).entry).toEqual(first.entry);
    await rpc(
      h.audit.recordAudit.bind(h.audit),
      RecordAuditRequest.fromPartial({ ...req, action: "Blocked customer", idempotencyKey: "" }),
      ops,
    );

    const { entries, page } = await rpc(
      h.audit.listAuditEntries.bind(h.audit),
      ListAuditEntriesRequest.fromPartial({
        recordType: AuditRecordType.AUDIT_RECORD_TYPE_CUSTOMER,
        recordId,
      }),
      ops,
    );
    expect(entries.map((e) => e.action)).toEqual(["Blocked customer", "Issued Rs 300 Kadé credit"]);
    expect(page?.totalSize).toBe(2);

    const { staff } = await rpc(h.staff.listStaff.bind(h.staff), {}, ops);
    expect(staff.find((s) => s.id === keycloakUserId(5))?.lastActiveAt).toBeDefined();

    expect(
      await grpcError(
        rpc(h.audit.recordAudit.bind(h.audit), RecordAuditRequest.fromPartial({ action: "x" }), ops),
      ),
    ).toEqual({ code: status.INVALID_ARGUMENT, reason: "AUDIT_RECORD_TYPE_REQUIRED" });
  });
});
