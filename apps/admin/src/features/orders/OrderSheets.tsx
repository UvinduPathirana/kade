import { Choice, Select, TextArea, TextField, formatRs, useToast } from "@kade/ui";
import { useState } from "react";
import { faultLabels, type OrderView } from "@/api/orders";
import { useCancelOrder, useNearbyRiders, useRefundOrder, useReassignRider } from "@/api/queries";
import type { Fault, RefundMethod } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import u from "@/components/ui.module.css";

interface SheetProps {
  order: OrderView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const vehicleLabel = { motorbike: "Motorbike", tukTuk: "Tuk-tuk", bicycle: "Bicycle" } as const;
/** Ops staff can refund up to this much on their own (see Team, roles and permissions). */
export const OPS_REFUND_LIMIT = 5000;

/* ---------- Assign another rider ---------- */

const reassignReasons = [
  "Rider isn't moving",
  "Rider asked to swap",
  "Vehicle problem",
  "A closer rider is free",
  "Rider is over their cash limit",
];

export function ReassignSheet({ order, open, onOpenChange }: SheetProps) {
  const toast = useToast();
  const riders = useNearbyRiders(order.id, open);
  const mutation = useReassignRider();
  const [riderId, setRiderId] = useState("");
  const [reason, setReason] = useState(reassignReasons[0]!);
  const chosen = riders.data?.find((r) => r.id === riderId);

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Assign another rider to ${order.id}`}
      submitLabel={chosen ? `Assign ${chosen.name.split(" ")[0]}` : "Assign rider"}
      pending={mutation.isPending}
      validate={() => (riderId ? null : "Choose a rider to assign.")}
      onSubmit={async () => {
        await mutation.mutateAsync({ orderId: order.id, riderId, reason });
        toast({
          title: "Rider assigned",
          description: `${chosen?.name} is collecting ${order.id}. ${order.rider ? `${order.rider.name} has been told.` : ""}`,
          tone: "success",
        });
      }}
    >
      <p className={u.muted}>
        Riders closest to {order.restaurant.name}, free riders first.
        {order.rider && ` ${order.rider.name} is assigned now.`}
      </p>
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>Nearby riders</legend>
        {riders.isLoading && <p className={u.muted}>Finding riders near {order.restaurant.area}…</p>}
        {riders.data?.length === 0 && (
          <p className={u.alertText}>
            No riders are online near here. Try again in a few minutes or cancel the order.
          </p>
        )}
        {riders.data?.map((r) => {
          const overCash = order.payment === "cash" && r.cashHeld > 15000;
          return (
            <Choice
              key={r.id}
              type="radio"
              name="rider"
              value={r.id}
              checked={riderId === r.id}
              onChange={() => setRiderId(r.id)}
              label={
                <span className={u.cellStack}>
                  <span className={u.strong}>
                    {r.name} <span className={u.muted}>★ {r.rating.toFixed(1)}</span>
                  </span>
                  <span>
                    {vehicleLabel[r.vehicle]}, {r.km} km away in {r.zoneCode}.{" "}
                    {r.status === "onJob" ? "Finishing a delivery." : "Free now."}
                    {overCash && <span className={u.alertText}> Holding {formatRs(r.cashHeld)} cash.</span>}
                  </span>
                </span>
              }
            />
          );
        })}
      </fieldset>
      <Select
        label="Why are you reassigning?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={reassignReasons.map((r) => ({ value: r, label: r }))}
      />
    </ActionSheet>
  );
}

/* ---------- Refund ---------- */

const refundReasons = [
  "Missing item",
  "Wrong item",
  "Late delivery",
  "Food quality",
  "Spilled in transit",
  "Other",
];

export function RefundSheet({ order, open, onOpenChange }: SheetProps) {
  const toast = useToast();
  const mutation = useRefundOrder();
  const refundable = order.total - order.refunded;
  const [scope, setScope] = useState<"full" | "part">("part");
  const [lines, setLines] = useState<number[]>([]);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState(refundReasons[0]!);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<RefundMethod>(order.payment === "card" ? "card" : "credit");

  const amount = scope === "full" ? refundable : Number(amountText.replace(/[^\d]/g, "")) || 0;
  const toggleLine = (i: number) => {
    const next = lines.includes(i) ? lines.filter((x) => x !== i) : [...lines, i];
    setLines(next);
    const sum = next.reduce((s, j) => s + order.lines[j]!.qty * order.lines[j]!.price, 0);
    setAmountText(sum ? String(Math.min(sum, refundable)) : "");
  };
  const to = method === "card" ? `card ending ${order.cardLast4}` : "Kadé credit";

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Refund ${order.id}`}
      submitLabel={amount ? `Refund ${formatRs(amount)}` : "Refund"}
      pending={mutation.isPending}
      validate={() => {
        if (amount < 1) return "Enter an amount, or tick the items to refund.";
        if (amount > refundable) return `You can refund up to ${formatRs(refundable)} on this order.`;
        if (amount > OPS_REFUND_LIMIT)
          return `Refunds over ${formatRs(OPS_REFUND_LIMIT)} need finance or an admin. Ask Hasini or Kasun to approve it.`;
        if (reason === "Other" && !note.trim())
          return "Say why you're refunding, so finance can follow it later.";
        return null;
      }}
      confirm={{
        title: `Refund ${formatRs(amount)} to ${to}?`,
        description:
          method === "card"
            ? `${order.customer.name} gets an SMS now; the money reaches their card in 5 to 7 working days. Refunds can't be reversed.`
            : `${order.customer.name} can spend it on their next order straight away. Refunds can't be reversed.`,
        confirmLabel: `Refund ${formatRs(amount)}`,
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({
          orderId: order.id,
          amount,
          method,
          reason: note.trim() ? `${reason}: ${note.trim()}` : reason,
        });
        toast({
          title: "Refund issued",
          description: `${formatRs(amount)} to ${to} on ${order.id}.`,
          tone: "success",
        });
      }}
    >
      <p className={u.muted}>
        Paid {formatRs(order.total)}
        {order.refunded ? `, ${formatRs(order.refunded)} already refunded` : ""}. Up to {formatRs(refundable)}{" "}
        left.
      </p>
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>How much</legend>
        <Choice
          type="radio"
          name="scope"
          checked={scope === "full"}
          onChange={() => setScope("full")}
          label="Everything left on the order"
          meta={formatRs(refundable)}
        />
        <Choice
          type="radio"
          name="scope"
          checked={scope === "part"}
          onChange={() => setScope("part")}
          label="Part of it"
        />
      </fieldset>
      {scope === "part" && (
        <>
          <fieldset className={u.fieldset}>
            <legend className={u.legend}>Items to refund</legend>
            {order.lines.map((l, i) => (
              <label key={l.name} className={u.check}>
                <input type="checkbox" checked={lines.includes(i)} onChange={() => toggleLine(i)} />
                <span>
                  {l.qty} × {l.name}
                </span>
                <span className={`${u.muted} ${u.num}`}>{formatRs(l.qty * l.price)}</span>
              </label>
            ))}
          </fieldset>
          <TextField
            label="Amount"
            prefix="Rs"
            inputMode="numeric"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            hint="Tick items to fill this in, or type an amount."
          />
        </>
      )}
      <Select
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={refundReasons.map((r) => ({ value: r, label: r }))}
      />
      <TextArea
        label={reason === "Other" ? "What happened" : "Note for finance (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
      />
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>Refund to</legend>
        <Choice
          type="radio"
          name="method"
          checked={method === "card"}
          disabled={order.payment !== "card"}
          onChange={() => setMethod("card")}
          label={
            order.payment === "card"
              ? `Card ending ${order.cardLast4}`
              : "Card (paid in cash, so not available)"
          }
          meta="5 to 7 working days"
        />
        <Choice
          type="radio"
          name="method"
          checked={method === "credit"}
          onChange={() => setMethod("credit")}
          label="Kadé credit"
          meta="Ready now"
        />
      </fieldset>
    </ActionSheet>
  );
}

/* ---------- Cancel ---------- */

const cancelReasons = [
  "Restaurant can't make the order",
  "No rider available",
  "Customer asked to cancel",
  "Customer unreachable at the door",
  "Suspected fraud",
  "Other",
];

const faultHelp: Record<Fault, string> = {
  customer: "No refund for food already cooked; the restaurant is still paid.",
  restaurant: "The refund comes out of the restaurant's next payout.",
  rider: "Logged against the rider; Kadé covers the refund.",
  kade: "Kadé covers the refund and the restaurant is paid.",
};

export function CancelSheet({ order, open, onOpenChange }: SheetProps) {
  const toast = useToast();
  const mutation = useCancelOrder();
  const [reason, setReason] = useState(cancelReasons[0]!);
  const [other, setOther] = useState("");
  const [fault, setFault] = useState<Fault>("restaurant");
  const [refund, setRefund] = useState(order.payment === "card");
  const refundable = order.total - order.refunded;
  const finalReason = reason === "Other" ? other.trim() : reason;

  return (
    <ActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Cancel ${order.id}`}
      submitLabel="Cancel order"
      pending={mutation.isPending}
      validate={() => (finalReason ? null : "Say why the order is being cancelled.")}
      confirm={{
        title: `Cancel ${order.id}?`,
        description: `${order.customer.name}, ${order.restaurant.name}${order.rider ? ` and ${order.rider.name}` : ""} are told straight away. ${
          refund && order.payment === "card" ? `${formatRs(refundable)} goes back to the card. ` : ""
        }This can't be undone.`,
        confirmLabel: "Cancel order",
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({ orderId: order.id, reason: finalReason, fault, refund });
        toast({ title: "Order cancelled", description: `${order.id}: ${finalReason}.`, tone: "success" });
      }}
    >
      <Select
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={cancelReasons.map((r) => ({ value: r, label: r }))}
      />
      {reason === "Other" && (
        <TextField label="What happened" value={other} onChange={(e) => setOther(e.target.value)} />
      )}
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>Who's at fault</legend>
        {(Object.keys(faultLabels) as Fault[]).map((f) => (
          <Choice
            key={f}
            type="radio"
            name="fault"
            checked={fault === f}
            onChange={() => setFault(f)}
            label={
              <span className={u.cellStack}>
                <span className={u.strong}>{faultLabels[f]}</span>
                <span>{faultHelp[f]}</span>
              </span>
            }
          />
        ))}
      </fieldset>
      {order.payment === "card" ? (
        <label className={u.check}>
          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
          Refund {formatRs(refundable)} to card ending {order.cardLast4}
        </label>
      ) : (
        <p className={u.muted}>Paid in cash on delivery, so there's nothing to refund.</p>
      )}
    </ActionSheet>
  );
}
