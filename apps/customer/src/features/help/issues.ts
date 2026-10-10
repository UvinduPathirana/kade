import type { IssueKind } from "@/api/types";

export const issueKinds: { value: IssueKind; label: string; detail: string; deliveryOnly?: boolean }[] = [
  { value: "missing", label: "Something was missing", detail: "A dish or part of one wasn't in the bag" },
  { value: "wrong", label: "I got the wrong dish", detail: "Something came that you didn't order" },
  { value: "spilled", label: "It spilled or was damaged", detail: "Leaked, crushed or opened" },
  {
    value: "late",
    label: "It arrived very late",
    detail: "Well past the time we showed",
    deliveryOnly: true,
  },
  {
    value: "neverArrived",
    label: "It never arrived",
    detail: "Marked delivered, but nothing came",
    deliveryOnly: true,
  },
  { value: "charged", label: "I was charged the wrong amount", detail: "The total or a charge looks wrong" },
];

/** Problems that need the affected dishes picked out. */
export const needsItems = (kind: IssueKind) => kind === "missing" || kind === "wrong" || kind === "spilled";
