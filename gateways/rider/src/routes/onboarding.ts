import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import { fromApplication, toApplicationStatus } from "../mappers.js";
import { ApplicationInput, ApplicationStatus, DocKey, problems, ref } from "../schemas.js";
import { IdempotencyHeaders, idempotencyKey, type RouteDeps } from "./context.js";

/**
 * Rider sign-up (dispatch RiderService), before the person has an account: public routes. Status is
 * looked up by the phone number the application was made with and only says where it stands.
 */
export const onboardingRoutes =
  ({ u, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const config = { auth: "public" as const, rider: false };
    const tags = ["onboarding"];
    const status = { 200: ref(ApplicationStatus), ...problems(400, 404, 503, 504) };

    app.post(
      "/v1/applications",
      {
        config,
        schema: {
          operationId: "submitApplication",
          tags,
          headers: IdempotencyHeaders,
          body: ref(ApplicationInput),
          response: { 201: ref(ApplicationStatus), ...problems(400, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.riders.submitRiderApplication.bind(u.riders),
          fromApplication(req.body, idempotencyKey(req)),
          callContext(req, reply),
        );
        return reply.code(201).send(toApplicationStatus(res.application));
      },
    );

    app.get(
      "/v1/applications/status",
      {
        config,
        schema: {
          operationId: "getApplicationStatus",
          tags,
          querystring: Type.Object({ phone: Type.String({ minLength: 7, maxLength: 20 }) }),
          response: status,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.riders.getRiderApplicationStatus.bind(u.riders),
          { phone: req.query.phone.trim() },
          callContext(req, reply),
        );
        return toApplicationStatus(res.application, res.needsFix);
      },
    );

    app.post(
      "/v1/applications/:id/documents",
      {
        config,
        schema: {
          operationId: "resubmitDocument",
          tags,
          summary: "Re-upload the document the reviewer asked about",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          body: Type.Object({ doc: DocKey, fileName: Type.String({ minLength: 1, maxLength: 200 }) }),
          response: status,
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.riders.resubmitRiderDocument.bind(u.riders),
          {
            applicationId: req.params.id,
            documentKind: req.body.doc,
            fileName: req.body.fileName,
            fileRef: "",
          },
          callContext(req, reply),
        );
        return toApplicationStatus(res.application);
      },
    );
  };
