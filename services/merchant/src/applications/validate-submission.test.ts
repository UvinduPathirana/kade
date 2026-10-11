import { DocumentStatus } from "@kade/proto/kade/common/v1/onboarding";
import { BusinessType, SubmitApplicationRequest } from "@kade/proto/kade/merchant/v1/merchant_service";
import { describe, expect, it } from "vitest";
import type { DomainError } from "../platform/grpc/errors.js";
import { validateSubmission } from "./applications.grpc.js";

const base = SubmitApplicationRequest.fromPartial({
  business: {
    name: " Kottu Lab ",
    type: BusinessType.BUSINESS_TYPE_CLOUD_KITCHEN,
    address: "5 Havelock Road",
    city: "Colombo",
    area: "Havelock Town",
  },
  owner: {
    name: "Shiran Gunawardena",
    phone: "077 210 5512",
    email: "hello@kottulab.lk",
    nic: "199312904455",
  },
  documents: [
    { kind: "registration", fileName: "br.pdf" },
    { kind: "foodSafety", fileName: "phi.png" },
    { kind: "ownerId", fileName: "" },
  ],
  bank: {
    bank: "Sampath Bank",
    branch: "Havelock",
    accountName: "S. Gunawardena",
    accountNumber: "1234 5678 9012",
  },
});

function reason(req: SubmitApplicationRequest): string {
  try {
    validateSubmission(req);
  } catch (e) {
    return (e as DomainError).reason;
  }
  return "OK";
}

describe("validateSubmission", () => {
  it("normalises the phone, names documents, keeps only last4 of the bank account for reads", () => {
    const s = validateSubmission(base);
    expect(s.phone).toBe("+94772105512");
    expect(s.business.name).toBe("Kottu Lab");
    expect(s.documents.map((d) => [d.kind, d.name, d.status])).toEqual([
      ["registration", "Business registration", DocumentStatus.DOCUMENT_STATUS_PENDING],
      ["foodSafety", "Food safety certificate (PHI)", DocumentStatus.DOCUMENT_STATUS_PENDING],
    ]);
    expect(s.bank).toEqual({
      bank: "Sampath Bank",
      branch: "Havelock",
      accountName: "S. Gunawardena",
      accountLast4: "9012",
    });
    expect(s.bankAccountNumber).toBe("123456789012");
  });

  it.each([
    [{ business: { ...base.business!, name: " " } }, "BUSINESS_NAME_REQUIRED"],
    [
      { business: { ...base.business!, type: BusinessType.BUSINESS_TYPE_UNSPECIFIED } },
      "BUSINESS_TYPE_REQUIRED",
    ],
    [{ owner: { ...base.owner!, phone: "123" } }, "PHONE_INVALID"],
    [{ owner: { ...base.owner!, email: "nope" } }, "EMAIL_INVALID"],
    [{ documents: [] }, "DOCUMENTS_REQUIRED"],
    [{ bank: { ...base.bank!, accountNumber: "12ab" } }, "ACCOUNT_NUMBER_INVALID"],
  ])("rejects %o with %s", (over, expected) => {
    expect(reason({ ...base, ...over } as SubmitApplicationRequest)).toBe(expected);
  });
});
