import { status } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "./error-details.js";
import { notFound, toGrpcError } from "./errors.js";

function details(err: ReturnType<typeof toGrpcError>) {
  const bin = err.response.metadata?.get(STATUS_DETAILS_KEY)[0] as Buffer;
  return decodeErrorInfo(bin);
}

describe("toGrpcError", () => {
  it("maps a DomainError to its code with ErrorInfo reason, domain and metadata", () => {
    const mapped = toGrpcError(
      notFound("NOTE_NOT_FOUND", "We couldn't find that note.", { id: "n1" }),
      "review",
    );
    expect(mapped.unexpected).toBe(false);
    expect(mapped.response).toMatchObject({ code: status.NOT_FOUND, details: "We couldn't find that note." });
    expect(details(mapped)).toEqual({
      reason: "NOTE_NOT_FOUND",
      domain: "review",
      metadata: { id: "n1" },
    });
  });

  it("maps a Postgres statement timeout (wrapped by Drizzle) to DEADLINE_EXCEEDED", () => {
    const pgError = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
    const mapped = toGrpcError(new Error("Failed query", { cause: pgError }), "svc");
    expect(mapped.response.code).toBe(status.DEADLINE_EXCEEDED);
    expect(details(mapped)?.reason).toBe("DEADLINE_EXCEEDED");
  });

  it("hides unexpected errors behind INTERNAL", () => {
    const mapped = toGrpcError(new Error('relation "secret" does not exist'), "svc");
    expect(mapped.unexpected).toBe(true);
    expect(mapped.response).toMatchObject({ code: status.INTERNAL, details: "internal error" });
    expect(details(mapped)?.reason).toBe("INTERNAL");
  });
});
