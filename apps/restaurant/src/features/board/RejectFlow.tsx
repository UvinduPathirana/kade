import { Button, Choice, ChoiceGroup, ConfirmDialog, Sheet, TextArea, useToast } from "@kade/ui";
import { useState } from "react";
import { rejectReasons } from "@/api/orders";
import { useRejectTicket, useSetSoldOut } from "@/api/queries";
import type { RejectReason, Ticket } from "@/api/types";
import styles from "./RejectFlow.module.css";

/**
 * Reject in two steps: say why (so the customer gets an honest message), then confirm, because a
 * rejected order can't be brought back. "Sold out" can also switch the dish off for the rest of today.
 */
export function RejectFlow({
  ticket,
  open,
  onOpenChange,
}: {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  const reject = useRejectTicket();
  const setSoldOut = useSetSoldOut();
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [soldOutIds, setSoldOutIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const next = () => {
    if (!reason) return setError("Choose a reason to continue.");
    if (reason === "soldOut" && soldOutIds.length === 0) return setError("Choose the dish that's sold out.");
    if (reason === "other" && !note.trim()) return setError("Write a short reason for the customer.");
    setError("");
    onOpenChange(false);
    setConfirming(true);
  };

  const confirm = () => {
    if (!reason) return;
    reject.mutate(
      { id: ticket.id, reason, note: note.trim() },
      {
        onSuccess: () => {
          for (const itemId of soldOutIds) setSoldOut.mutate({ itemId, soldOut: true });
          toast({
            title: "Order rejected",
            description:
              soldOutIds.length > 0
                ? `${ticket.customerName} has been refunded. Sold-out dishes are off the menu for today.`
                : `${ticket.customerName} has been told and refunded.`,
            tone: "success",
          });
        },
        onError: (e) => toast({ title: "Order not rejected", description: e.message, tone: "error" }),
      },
    );
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={`Why can't you take order #${ticket.id}?`}
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
        footer={
          <div className={styles.foot}>
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
              Keep order
            </Button>
            <Button type="submit" size="lg">
              Continue
            </Button>
          </div>
        }
      >
        <p className={styles.lead}>We tell {ticket.customerName} the reason and refund them in full.</p>
        <ChoiceGroup
          legend="Reason"
          hint="Required"
          required
          complete={!!reason}
          error={error && !reason ? error : undefined}
        >
          {(Object.keys(rejectReasons) as RejectReason[]).map((r) => (
            <Choice
              key={r}
              type="radio"
              name="reject-reason"
              label={rejectReasons[r]}
              checked={reason === r}
              onChange={() => {
                setReason(r);
                setError("");
              }}
              className={styles.choice}
            />
          ))}
        </ChoiceGroup>

        {reason === "soldOut" && (
          <ChoiceGroup
            legend="Which dish is sold out?"
            hint="We'll mark it sold out for today"
            required
            complete={soldOutIds.length > 0}
            error={error && soldOutIds.length === 0 ? error : undefined}
            className={styles.group}
          >
            {ticket.lines.map((l) => (
              <Choice
                key={l.itemId}
                type="checkbox"
                label={l.name}
                checked={soldOutIds.includes(l.itemId)}
                onChange={(e) =>
                  setSoldOutIds((ids) =>
                    e.target.checked ? [...ids, l.itemId] : ids.filter((x) => x !== l.itemId),
                  )
                }
                className={styles.choice}
              />
            ))}
          </ChoiceGroup>
        )}

        {reason === "other" && (
          <div className={styles.group}>
            <TextArea
              label="Reason for the customer"
              rows={3}
              maxLength={160}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For example: gas cylinder ran out"
            />
            {error && !note.trim() && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Reject order #${ticket.id}?`}
        description={`${ticket.customerName} gets a full refund and the message "${
          reason === "other" ? note.trim() : reason ? rejectReasons[reason] : ""
        }". You can't undo this.`}
        cancelLabel="Keep order"
        confirmLabel="Reject order"
        onConfirm={confirm}
      />
    </>
  );
}
