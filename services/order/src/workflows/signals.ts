// Signal and query definitions, shared by the workflow and its callers (consumers, RPCs, tests).
import { defineQuery, defineSignal } from "@temporalio/workflow";
import type {
  CancelSignal,
  CollectedSignal,
  DeliveredSignal,
  KitchenAcceptedSignal,
  KitchenRejectedSignal,
  PickedUpSignal,
  WorkflowState,
} from "./types.js";

/** merchant TicketAccepted. */
export const kitchenAcceptedSignal = defineSignal<[KitchenAcceptedSignal]>("kitchenAccepted");
/** merchant TicketRejected. */
export const kitchenRejectedSignal = defineSignal<[KitchenRejectedSignal]>("kitchenRejected");
/** order.CancelOrder (customer, ops) or the system (no rider found). */
export const cancelSignal = defineSignal<[CancelSignal]>("cancel");
/** merchant TicketReady. */
export const readySignal = defineSignal("ready");
/** dispatch DeliveryPickedUp. */
export const pickedUpSignal = defineSignal<[PickedUpSignal]>("pickedUp");
/** dispatch DeliveryCompleted. */
export const deliveredSignal = defineSignal<[DeliveredSignal]>("delivered");
/** order.MarkCollected or merchant TicketHandedOver (pickup orders). */
export const collectedSignal = defineSignal<[CollectedSignal]>("collected");

export const stateQuery = defineQuery<WorkflowState>("state");
