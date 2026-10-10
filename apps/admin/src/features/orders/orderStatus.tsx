import type { OrderView } from "@/api/orders";
import type { OrderStatus } from "@/api/types";
import { Status, type StatusTone } from "@/components/Status";
import { statusLabels } from "./orderHelpers";

const tones: Record<OrderStatus, StatusTone> = {
  placed: "progress",
  accepted: "progress",
  preparing: "progress",
  ready: "progress",
  pickedUp: "live",
  delivered: "done",
  cancelled: "stopped",
  rejected: "stopped",
};

export function OrderStatusTag({ order }: { order: Pick<OrderView, "status" | "lateMin"> }) {
  if (order.lateMin > 0)
    return (
      <Status tone="alert">
        {statusLabels[order.status]}, {order.lateMin} min late
      </Status>
    );
  return <Status tone={tones[order.status]}>{statusLabels[order.status]}</Status>;
}
