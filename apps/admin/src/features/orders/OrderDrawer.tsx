import { Button, Drawer, TextArea, cx, formatRs, useToast } from "@kade/ui";
import { useState } from "react";
import { isFinalStatus } from "./orderHelpers";
import { useAddOrderNote, useOrder } from "@/api/queries";
import { Contact } from "@/components/Contact";
import { DetailList, DrawerSection } from "@/components/DetailList";
import { QueryState } from "@/components/QueryState";
import { Timeline } from "@/components/Timeline";
import u from "@/components/ui.module.css";
import { formatClock, formatWhen } from "@/lib/format";
import { CancelSheet, ReassignSheet, RefundSheet } from "./OrderSheets";
import { statusSentence } from "./orderHelpers";
import { OrderStatusTag } from "./orderStatus";
import styles from "./OrderDrawer.module.css";

type SheetKind = "reassign" | "refund" | "cancel" | null;

/** Everything about one order, with the actions ops staff take on it. Refreshes every 5 seconds. */
export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const toast = useToast();
  const query = useOrder(orderId);
  const addNote = useAddOrderNote();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [note, setNote] = useState("");
  const o = query.data;
  const final = o ? isFinalStatus(o.status) : true;
  const refundable = o ? o.total - o.refunded : 0;

  return (
    <Drawer
      open={!!orderId}
      onOpenChange={(open) => !open && onClose()}
      title={orderId ? `Order ${orderId}` : "Order"}
      closeLabel="Close order"
      footer={
        o && (
          <div className={styles.footer}>
            <Button size="sm" icon="bike" disabled={final} onClick={() => setSheet("reassign")}>
              Assign rider
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="wallet"
              disabled={refundable <= 0}
              onClick={() => setSheet("refund")}
            >
              Refund
            </Button>
            <Button size="sm" variant="outline" disabled={final} onClick={() => setSheet("cancel")}>
              Cancel order
            </Button>
          </div>
        )
      }
    >
      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        what="this order"
      />
      {o && (
        <div className={styles.body}>
          <div className={cx(styles.summary, o.lateMin > 0 && styles.summaryLate)}>
            <OrderStatusTag order={o} />
            <p>{statusSentence(o)}</p>
          </div>

          <DrawerSection title="People">
            <div className={styles.people}>
              <div>
                <p className={styles.role}>Customer</p>
                <p className={u.strong}>{o.customer.name}</p>
                <Contact name={o.customer.name} phone={o.customer.phone} />
              </div>
              <div>
                <p className={styles.role}>Restaurant</p>
                <p className={u.strong}>
                  {o.restaurant.name} <span className={u.muted}>{o.restaurant.area}</span>
                </p>
                <Contact name={o.restaurant.name} phone={o.restaurant.phone} />
              </div>
              <div>
                <p className={styles.role}>Rider</p>
                {o.rider ? (
                  <>
                    <p className={u.strong}>
                      {o.rider.name} <span className={u.muted}>{o.rider.id}</span>
                    </p>
                    <Contact name={o.rider.name} phone={o.rider.phone} />
                  </>
                ) : (
                  <p className={final ? u.muted : u.alertText}>{final ? "None" : "Not assigned yet"}</p>
                )}
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Delivery">
            <DetailList
              items={[
                ["Placed", formatWhen(o.placedAt)],
                ["Promised by", formatClock(o.dueAt)],
                ["Address", `${o.address}, ${o.zone.code}`],
                ["Distance", `${o.distanceKm} km`],
                ["Payment", o.payment === "card" ? `Card ending ${o.cardLast4}` : "Cash on delivery"],
                ["Cancelled", o.cancel && `${o.cancel.reason}. By ${o.cancel.by}.`],
              ]}
            />
          </DrawerSection>

          <DrawerSection title="Items">
            <table className={styles.items}>
              <caption className="kd-visually-hidden">Items and totals for {o.id}</caption>
              <thead className="kd-visually-hidden">
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.name}>
                    <th scope="row">
                      {l.qty} × {l.name}
                    </th>
                    <td>{formatRs(l.qty * l.price)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Delivery fee</th>
                  <td>{formatRs(o.deliveryFee)}</td>
                </tr>
                {o.discount > 0 && (
                  <tr>
                    <th scope="row">Promo {o.promoCode}</th>
                    <td>−{formatRs(o.discount)}</td>
                  </tr>
                )}
                <tr className={styles.total}>
                  <th scope="row">Total</th>
                  <td>{formatRs(o.total)}</td>
                </tr>
                {o.refunded > 0 && (
                  <tr>
                    <th scope="row">Refunded</th>
                    <td>−{formatRs(o.refunded)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </DrawerSection>

          <DrawerSection title="What happened">
            <Timeline events={o.timeline} />
          </DrawerSection>

          <DrawerSection title={`Internal notes${o.notes.length ? ` (${o.notes.length})` : ""}`}>
            {o.notes.length > 0 && (
              <ul className={styles.notes}>
                {o.notes.map((n) => (
                  <li key={n.id}>
                    <p>{n.body}</p>
                    <p className={cx(u.small, u.muted)}>
                      {n.author}, {formatClock(n.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <form
              className={styles.noteForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                addNote.mutate(
                  { orderId: o.id, body: note.trim() },
                  {
                    onSuccess: () => {
                      setNote("");
                      toast({ title: "Note added", tone: "success" });
                    },
                    onError: (err) =>
                      toast({ title: "Note not saved", description: err.message, tone: "error" }),
                  },
                );
              }}
            >
              <TextArea
                label="Add a note for other staff"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Customers and partners never see these notes."
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={!note.trim() || addNote.isPending}
              >
                Add note
              </Button>
            </form>
          </DrawerSection>

          {sheet === "reassign" && <ReassignSheet order={o} open onOpenChange={() => setSheet(null)} />}
          {sheet === "refund" && <RefundSheet order={o} open onOpenChange={() => setSheet(null)} />}
          {sheet === "cancel" && <CancelSheet order={o} open onOpenChange={() => setSheet(null)} />}
        </div>
      )}
    </Drawer>
  );
}
