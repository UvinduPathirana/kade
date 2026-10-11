// kade.order.events builders. Every event is written through the outbox (aggregatetype "order",
// key = order id; GroupOrderUpdated uses the group id).
import {
  GroupOrderUpdated,
  OrderAccepted,
  OrderCancelled,
  OrderCollected,
  OrderDelivered,
  OrderFailed,
  OrderPickedUp,
  OrderPlaced,
  OrderPreparing,
  OrderReady,
  OrderRefunded,
  OrderRejected,
  OrderReleasedToKitchen,
  OrderRiderChanged,
  OrderTipUpdated,
} from "@kade/proto/kade/order/v1/order_events";
import type { Actor } from "@kade/proto/kade/common/v1/types";
import type { Money } from "@kade/proto/kade/common/v1/money";
import type {
  Cancellation,
  GroupOrder,
  Order,
  OrderStatus,
  Refund,
} from "@kade/proto/kade/order/v1/order_service";

export interface OrderEvent {
  type: string;
  payload: Uint8Array;
  /** Kafka key; defaults to the order id. */
  aggregateId?: string;
}

const T = "kade.order.v1.";
const ids = (o: Order) => ({
  orderId: o.id,
  orderNumber: o.orderNumber,
  customerId: o.customer?.id ?? "",
  restaurantId: o.restaurant?.id ?? "",
});

export const orderEvents = {
  placed: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderPlaced`,
    payload: OrderPlaced.encode({ orderId: order.id, order, occurredAt: at }).finish(),
  }),
  released: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderReleasedToKitchen`,
    payload: OrderReleasedToKitchen.encode({ orderId: order.id, order, occurredAt: at }).finish(),
  }),
  accepted: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderAccepted`,
    payload: OrderAccepted.encode({
      orderId: order.id,
      order,
      prepMinutes: order.prepMinutes,
      readyBy: order.readyBy,
      occurredAt: at,
    }).finish(),
  }),
  rejected: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderRejected`,
    payload: OrderRejected.encode({
      orderId: order.id,
      order,
      rejection: order.rejection,
      occurredAt: at,
    }).finish(),
  }),
  preparing: (order: Order, at: Date): OrderEvent => {
    const { orderId, orderNumber, customerId, restaurantId } = ids(order);
    return {
      type: `${T}OrderPreparing`,
      payload: OrderPreparing.encode({
        orderId,
        orderNumber,
        customerId,
        restaurantId,
        readyBy: order.readyBy,
        occurredAt: at,
      }).finish(),
    };
  },
  ready: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderReady`,
    payload: OrderReady.encode({
      ...ids(order),
      mode: order.mode,
      deliveryId: order.deliveryId,
      occurredAt: at,
    }).finish(),
  }),
  riderChanged: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderRiderChanged`,
    payload: OrderRiderChanged.encode({
      ...ids(order),
      rider: order.rider,
      deliveryId: order.deliveryId,
      occurredAt: at,
    }).finish(),
  }),
  pickedUp: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderPickedUp`,
    payload: OrderPickedUp.encode({
      ...ids(order),
      riderId: order.rider?.riderId ?? "",
      occurredAt: at,
    }).finish(),
  }),
  delivered: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderDelivered`,
    payload: OrderDelivered.encode({ orderId: order.id, order, occurredAt: at }).finish(),
  }),
  collected: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderCollected`,
    payload: OrderCollected.encode({ orderId: order.id, order, occurredAt: at }).finish(),
  }),
  cancelled: (order: Order, previous: OrderStatus, cancellation: Cancellation, at: Date): OrderEvent => ({
    type: `${T}OrderCancelled`,
    payload: OrderCancelled.encode({
      orderId: order.id,
      order,
      cancellation,
      previousStatus: previous,
      occurredAt: at,
    }).finish(),
  }),
  failed: (order: Order, at: Date): OrderEvent => ({
    type: `${T}OrderFailed`,
    payload: OrderFailed.encode({
      orderId: order.id,
      customerId: order.customer?.id ?? "",
      restaurantId: order.restaurant?.id ?? "",
      failureReason: order.failureReason,
      occurredAt: at,
    }).finish(),
  }),
  tipUpdated: (order: Order, previousTip: Money | undefined, at: Date): OrderEvent => ({
    type: `${T}OrderTipUpdated`,
    payload: OrderTipUpdated.encode({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customer?.id ?? "",
      riderId: order.rider?.riderId ?? "",
      tip: order.totals?.tip,
      previousTip,
      total: order.totals?.total,
      occurredAt: at,
    }).finish(),
  }),
  refunded: (order: Order, refund: Refund, actor: Actor | undefined, at: Date): OrderEvent => ({
    type: `${T}OrderRefunded`,
    payload: OrderRefunded.encode({
      orderId: order.id,
      refund,
      refundedTotal: order.refunded,
      restaurantId: order.restaurant?.id ?? "",
      actor,
      occurredAt: at,
    }).finish(),
  }),
  groupUpdated: (group: GroupOrder, at: Date): OrderEvent => ({
    type: `${T}GroupOrderUpdated`,
    aggregateId: group.id,
    payload: GroupOrderUpdated.encode({ groupId: group.id, group, occurredAt: at }).finish(),
  }),
};
