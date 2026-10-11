import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import {
  ROLE_FROM_APP,
  fromApplication,
  fromSettings,
  toSettings,
  toStaffMember,
  toSubmitted,
} from "../mappers.js";
import {
  Me,
  PartnerApplication,
  PartnerSettings,
  StaffMember,
  StaffRole,
  SubmittedApplication,
  problems,
  ref,
} from "../schemas.js";
import {
  IdempotencyHeaders,
  OWNER,
  STAFF,
  idempotencyKey,
  outletOf,
  security,
  type RouteDeps,
} from "./context.js";

/** Who is signed in, staff, tablet settings (merchant) and the public partner application form. */
export const partnerRoutes =
  ({ u, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const staff = { roles: STAFF };
    const owner = { roles: OWNER };
    const staffList = { 200: Type.Array(ref(StaffMember)), ...problems(400, 401, 403, 404, 503, 504) };

    app.get(
      "/v1/me",
      {
        config: staff,
        schema: {
          operationId: "getMe",
          tags: ["account"],
          security,
          summary: "The signed-in staff member and the outlet they work at",
          response: { 200: ref(Me), ...problems(401, 403, 503) },
        },
      },
      async (req) => {
        const id = req.identity!;
        return {
          userId: id.userId,
          name: id.name ?? "",
          roles: id.roles,
          outletId: outletOf(req),
          outletName: req.staffOutlet?.outletName ?? "",
        };
      },
    );

    // ---------- Staff ----------

    app.get(
      "/v1/staff",
      {
        config: staff,
        schema: {
          operationId: "listStaff",
          tags: ["staff"],
          security,
          summary: "Everyone with access to this outlet",
          response: staffList,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.staff.listOutletStaff.bind(u.staff),
          { outletId: outletOf(req) },
          callContext(req, reply),
        );
        return res.staff.map(toStaffMember);
      },
    );

    app.post(
      "/v1/staff",
      {
        config: owner,
        schema: {
          operationId: "inviteStaff",
          tags: ["staff"],
          security,
          summary: "Sends an SMS invite; pending until they first sign in",
          body: Type.Object({
            name: Type.String({ minLength: 1, maxLength: 120 }),
            phone: Type.String({ minLength: 7, maxLength: 20 }),
            role: StaffRole,
          }),
          response: { 201: ref(StaffMember), ...problems(400, 401, 403, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.staff.inviteOutletStaff.bind(u.staff),
          {
            outletId: outletOf(req),
            name: req.body.name.trim(),
            phone: req.body.phone.trim(),
            role: ROLE_FROM_APP[req.body.role as keyof typeof ROLE_FROM_APP],
          },
          callContext(req, reply),
        );
        return reply.code(201).send(toStaffMember(res.member));
      },
    );

    app.put(
      "/v1/staff/:id/role",
      {
        config: owner,
        schema: {
          operationId: "changeRole",
          tags: ["staff"],
          security,
          summary: "Changes someone's role; answers with the whole team",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          body: Type.Object({ role: StaffRole }),
          response: staffList,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.staff.changeOutletStaffRole.bind(u.staff),
          {
            outletId: outletOf(req),
            staffId: req.params.id,
            role: ROLE_FROM_APP[req.body.role as keyof typeof ROLE_FROM_APP],
          },
          callContext(req, reply),
        );
        return res.staff.map(toStaffMember);
      },
    );

    app.delete(
      "/v1/staff/:id",
      {
        config: owner,
        schema: {
          operationId: "removeStaff",
          tags: ["staff"],
          security,
          summary: "Removes someone's access; answers with the whole team",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          response: staffList,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.staff.removeOutletStaff.bind(u.staff),
          { outletId: outletOf(req), staffId: req.params.id },
          callContext(req, reply),
        );
        return res.staff.map(toStaffMember);
      },
    );

    // ---------- Tablet settings ----------

    const settingsAnswers = { 200: ref(PartnerSettings), ...problems(400, 401, 403, 503, 504) };

    app.get(
      "/v1/settings",
      {
        config: staff,
        schema: { operationId: "getSettings", tags: ["settings"], security, response: settingsAnswers },
      },
      async (req, reply) => {
        const res = await unary(
          u.outlets.getOutletSettings.bind(u.outlets),
          { outletId: outletOf(req) },
          callContext(req, reply),
        );
        return toSettings(res.settings);
      },
    );

    app.put(
      "/v1/settings",
      {
        config: staff,
        schema: {
          operationId: "saveSettings",
          tags: ["settings"],
          security,
          body: ref(PartnerSettings),
          response: settingsAnswers,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.outlets.updateOutletSettings.bind(u.outlets),
          { outletId: outletOf(req), settings: fromSettings(req.body) },
          callContext(req, reply),
        );
        return toSettings(res.settings);
      },
    );

    app.post(
      "/v1/settings/print-test",
      {
        config: staff,
        schema: {
          operationId: "printTestTicket",
          tags: ["settings"],
          security,
          summary: "Sends a sample ticket to the paired printer",
          response: {
            200: Type.Object({ printerName: Type.String(), message: Type.String() }),
            ...problems(401, 403, 503, 504),
          },
        },
      },
      async (req, reply) => {
        const ctx = callContext(req, reply);
        const outletId = outletOf(req);
        const [printed, settings] = await Promise.all([
          unary(u.outlets.printTestTicket.bind(u.outlets), { outletId }, ctx),
          unary(u.outlets.getOutletSettings.bind(u.outlets), { outletId }, ctx),
        ]);
        return { printerName: settings.settings?.devices?.printerName ?? "", message: printed.message };
      },
    );

    // ---------- Onboarding (signed out) ----------

    app.post(
      "/v1/applications",
      {
        config: { auth: "public", outlet: false },
        schema: {
          operationId: "submitApplication",
          tags: ["onboarding"],
          summary: "Restaurant partner application (no sign-in needed)",
          headers: IdempotencyHeaders,
          body: ref(PartnerApplication),
          response: { 201: ref(SubmittedApplication), ...problems(400, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.applications.submitApplication.bind(u.applications),
          fromApplication(req.body, idempotencyKey(req)),
          callContext(req, reply),
        );
        return reply.code(201).send(toSubmitted(res.application, req.body));
      },
    );
  };
