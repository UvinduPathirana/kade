import { status } from "@grpc/grpc-js";
import { Inject, Injectable } from "@nestjs/common";
import {
  PhoneSignInServiceService,
  SignInApp,
  type StartPhoneSignInRequest,
  type StartPhoneSignInResponse,
  type VerifyPhoneSignInRequest,
  type VerifyPhoneSignInResponse,
} from "@kade/proto/kade/identity/v1/identity_service";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { Downstream } from "../clients/downstream.js";
import { ProfileStore } from "../customers/profile-store.js";
import { phoneChallenges } from "../db/schema.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import {
  DomainError,
  failedPrecondition,
  invalidArgument,
  resourceExhausted,
} from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { normalisePhone, PHONE_EMAIL_DOMAIN, phoneUsername } from "../shared/phone.js";
import { KeycloakAdmin, KeycloakUnavailableError } from "./keycloak-admin.js";

export const OTP_TTL_MS = 5 * 60_000;
export const RESEND_AFTER_MS = 30_000;
export const MAX_ATTEMPTS = 5;
/** At most this many codes per number per window. */
export const MAX_STARTS = 5;
export const START_WINDOW_MS = 15 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CLIENT_FOR_APP: Record<number, string> = {
  [SignInApp.SIGN_IN_APP_UNSPECIFIED]: "customer-app",
  [SignInApp.SIGN_IN_APP_CUSTOMER]: "customer-app",
  [SignInApp.SIGN_IN_APP_RIDER]: "rider-app",
  [SignInApp.SIGN_IN_APP_MERCHANT]: "merchant-app",
};

export const hashCode = (challengeId: string, code: string): string =>
  createHash("sha256").update(`${challengeId}:${code}`).digest("base64url");

const unavailable = (message: string) => new DomainError(status.UNAVAILABLE, "SIGN_IN_UNAVAILABLE", message);

/**
 * kade.identity.v1.PhoneSignInService. OTP_MODE=dev sends no SMS and every code is OTP_DEV_CODE
 * (123456, same as the apps' demo). OTP_MODE=sms generates a random code and sends it through
 * notification. Codes are stored hashed, live 5 minutes and allow 5 attempts.
 */
@GrpcService(PhoneSignInServiceService)
@Injectable()
export class PhoneSignInGrpcService implements GrpcHandlers<PhoneSignInServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(KeycloakAdmin) private readonly keycloak: KeycloakAdmin,
    @Inject(ProfileStore) private readonly store: ProfileStore,
    @Inject(Downstream) private readonly downstream: Downstream,
  ) {}

  async startPhoneSignIn(request: StartPhoneSignInRequest): Promise<StartPhoneSignInResponse> {
    const phone = normalisePhone(request.phone);
    if (!phone) {
      throw invalidArgument(
        "PHONE_INVALID",
        "Enter a Sri Lankan mobile number: 9 digits after +94, starting with 7.",
        { field: "phone" },
      );
    }
    const now = Date.now();
    const db = this.database.db;
    const recent = await db
      .select({ createdAt: phoneChallenges.createdAt })
      .from(phoneChallenges)
      .where(
        and(eq(phoneChallenges.phone, phone), gt(phoneChallenges.createdAt, new Date(now - START_WINDOW_MS))),
      )
      .orderBy(desc(phoneChallenges.createdAt));
    const last = recent[0]?.createdAt.getTime();
    if (recent.length >= MAX_STARTS || (last !== undefined && now - last < RESEND_AFTER_MS)) {
      const retryAt =
        recent.length >= MAX_STARTS
          ? recent[recent.length - 1]!.createdAt.getTime() + START_WINDOW_MS
          : last! + RESEND_AFTER_MS;
      throw resourceExhausted(
        "OTP_RATE_LIMITED",
        "Too many codes for this number. Wait a moment and try again.",
        {
          retryAfterSeconds: String(Math.max(1, Math.ceil((retryAt - now) / 1000))),
        },
      );
    }

    const id = uuidv7();
    const code =
      this.config.OTP_MODE === "dev"
        ? this.config.OTP_DEV_CODE
        : String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(now + OTP_TTL_MS);
    await db.insert(phoneChallenges).values({
      id,
      phone,
      app: request.app,
      codeHash: hashCode(id, code),
      expiresAt,
      createdAt: new Date(now),
    });
    if (this.config.OTP_MODE === "sms") {
      const sent = await this.downstream.sendOtpSms(phone, code, id);
      if (!sent) throw unavailable("We couldn't send a text right now. Try again in a minute.");
    } else {
      this.logger.info({ challengeId: id }, "dev OTP challenge created (code is OTP_DEV_CODE)");
    }
    return { challengeId: id, expiresAt, resendAfter: new Date(now + RESEND_AFTER_MS) };
  }

  async verifyPhoneSignIn(
    request: VerifyPhoneSignInRequest,
    ctx: RequestContext,
  ): Promise<VerifyPhoneSignInResponse> {
    const expired = () => failedPrecondition("OTP_EXPIRED", "That code has expired. Send a new code.");
    if (!UUID.test(request.challengeId)) throw expired();
    const code = request.code.replace(/\D/g, "");

    // Count the attempt in its own statement: it must stick even when the code is wrong.
    const [challenge] = await this.database.db
      .update(phoneChallenges)
      .set({ attempts: sql`${phoneChallenges.attempts} + 1` })
      .where(and(eq(phoneChallenges.id, request.challengeId), isNull(phoneChallenges.consumedAt)))
      .returning();
    if (!challenge || challenge.expiresAt.getTime() <= Date.now()) throw expired();
    if (challenge.attempts > MAX_ATTEMPTS) {
      throw resourceExhausted("OTP_RATE_LIMITED", "Too many wrong codes. Send a new code.");
    }
    if (!sameHash(hashCode(challenge.id, code), challenge.codeHash)) {
      throw invalidArgument(
        "OTP_INVALID",
        "That code doesn't match the one we sent. Check the text and try again.",
        {
          attemptsLeft: String(Math.max(0, MAX_ATTEMPTS - challenge.attempts)),
        },
      );
    }
    const [consumed] = await this.database.db
      .update(phoneChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(phoneChallenges.id, challenge.id), isNull(phoneChallenges.consumedAt)))
      .returning({ id: phoneChallenges.id });
    if (!consumed) throw expired(); // a concurrent verify used it first

    if (!this.keycloak.enabled) throw unavailable("Sign-in is unavailable right now. Try again shortly.");
    const username = phoneUsername(challenge.phone);
    try {
      const user = await this.keycloak.ensureUser({
        username,
        email: `${username}@${PHONE_EMAIL_DOMAIN}`,
        firstName: "Kade",
        lastName: "Customer",
      });
      const tokens = await this.keycloak.mintTokens(
        user.id,
        username,
        CLIENT_FOR_APP[challenge.app] ?? "customer-app",
      );
      let isNew = user.created;
      if (
        challenge.app === SignInApp.SIGN_IN_APP_CUSTOMER ||
        challenge.app === SignInApp.SIGN_IN_APP_UNSPECIFIED
      ) {
        const { row, created } = await this.database.transaction(ctx, (tx) =>
          this.store.ensure(tx, { id: user.id, phone: challenge.phone }),
        );
        isNew = created || !row.name;
      }
      const now = Date.now();
      return {
        userId: user.id,
        isNew,
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          accessExpiresAt: new Date(now + tokens.expiresIn * 1000),
          refreshExpiresAt: tokens.refreshExpiresIn
            ? new Date(now + tokens.refreshExpiresIn * 1000)
            : undefined,
        },
      };
    } catch (err) {
      if (err instanceof KeycloakUnavailableError) {
        this.logger.warn({ err }, "phone sign-in: keycloak failed");
        throw unavailable("Sign-in is unavailable right now. Try again shortly.");
      }
      throw err;
    }
  }
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
