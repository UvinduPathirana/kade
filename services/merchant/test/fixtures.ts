// Shared fixtures for unit and integration tests (not part of the build).
import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import { Order, OrderStatus } from "@kade/proto/kade/order/v1/order_service";

export const placedAt = new Date("2026-10-12T14:00:00Z");

export function order(over: Partial<Order> = {}): Order {
  return Order.fromPartial({
    id: "0199d3a0-0000-7000-8000-00000000aaaa",
    orderNumber: "KD-4821",
    status: OrderStatus.ORDER_STATUS_PLACED,
    mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
    customer: { id: "c1", name: "Dilini Perera", phone: "+94771234567" },
    restaurant: { id: "00000000-0000-7000-8000-000000000001", name: "Galle Road Kottu House" },
    lines: [
      {
        key: "l1",
        itemId: "1-1-0",
        name: "Chicken kottu",
        quantity: 2,
        unitPrice: { amountMinor: 115_000, currency: "LKR" },
        choiceNames: ["Sri Lankan hot"],
        note: "No leeks please",
      },
    ],
    kitchenNote: "Pack the gravy separately",
    cutlery: true,
    payment: { kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CASH },
    totals: { subtotal: { amountMinor: 230_000, currency: "LKR" } },
    placedAt,
    acceptBy: new Date(placedAt.getTime() + 180_000),
    customerRepeatCount: 3,
    ...over,
  });
}
