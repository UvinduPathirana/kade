import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import { OrderStatus, PlaceOrderRequest, type Order } from "@kade/proto/kade/order/v1/order_service";
import { lkr } from "./money.js";
import { newOrder } from "./order.grpc.js";

export const RESTAURANT_1 = "00000000-0000-7000-8000-000000000001";
export const DILINI = "00000000-0000-7000-8005-000000000001";

export function placeRequest(overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest {
  return PlaceOrderRequest.fromPartial({
    customerId: DILINI,
    restaurantId: RESTAURANT_1,
    mode: FulfilmentMode.FULFILMENT_MODE_DELIVERY,
    lines: [
      { key: "a", itemId: "item-0001", quantity: 2, options: [], note: "" },
      { key: "b", itemId: "item-0002", quantity: 1, options: [], note: "No leeks" },
    ],
    address: {
      id: "",
      label: "Home",
      line: "42 Flower Road",
      area: "Kollupitiya",
      note: "",
      location: { lat: 6.91, lng: 79.85 },
      zoneId: "",
    },
    payment: {
      kind: PaymentMethodKind.PAYMENT_METHOD_KIND_CARD,
      cardId: "card-1",
      cardBrand: 1,
      cardLast4: "4242",
    },
    tip: lkr(10_000),
    idempotencyKey: "key-1",
    ...overrides,
  });
}

export function order(status = OrderStatus.ORDER_STATUS_PENDING, overrides: Partial<Order> = {}): Order {
  const o = newOrder(placeRequest(), "KD-5001", new Date("2026-10-12T12:00:00Z"));
  o.status = status;
  o.restaurant = { ...o.restaurant!, name: "Galle Road Kottu House", etaMinMinutes: 15, etaMaxMinutes: 25 };
  o.totals = {
    itemCount: 3,
    subtotal: lkr(300_000),
    saving: lkr(0),
    deliveryFee: lkr(15_000),
    smallOrderFee: lkr(0),
    promoDiscount: lkr(0),
    tip: lkr(10_000),
    credit: lkr(0),
    total: lkr(325_000),
  };
  return Object.assign(o, overrides);
}
