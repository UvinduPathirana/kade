import { OrderStatus } from "@kade/proto/kade/order/v1/order_service";

export const FINAL_STATUSES: OrderStatus[] = [
  OrderStatus.ORDER_STATUS_DELIVERED,
  OrderStatus.ORDER_STATUS_COLLECTED,
  OrderStatus.ORDER_STATUS_CANCELLED,
  OrderStatus.ORDER_STATUS_REJECTED,
  OrderStatus.ORDER_STATUS_FAILED,
];

export const isFinal = (s: OrderStatus): boolean => FINAL_STATUSES.includes(s);

/** Statuses the kitchen has started on (after accept, before the end). */
export const IN_KITCHEN: OrderStatus[] = [
  OrderStatus.ORDER_STATUS_ACCEPTED,
  OrderStatus.ORDER_STATUS_PREPARING,
  OrderStatus.ORDER_STATUS_READY,
];
