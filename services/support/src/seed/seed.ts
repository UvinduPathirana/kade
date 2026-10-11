import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import {
  MessageAuthorKind,
  RequesterKind,
  ResolutionKind,
  TicketCategory,
  TicketChannel,
  TicketPriority,
  TicketStatus,
} from "@kade/proto/kade/support/v1/support_service";
import { macros, ticketMessages, tickets } from "../db/schema.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { slaDue } from "../tickets/rules.js";
import { shortName, staffId, staffName } from "../tickets/staff.js";

/**
 * The admin console's support queue (apps/admin mock backOffice.ts: T-3301…T-3312) and macros,
 * with the shared seeded ids (docs/backend/CONVENTIONS.md "Seeded ids"): customers 8002 (C-N),
 * riders 8001 (R-N), restaurants 8000, orders 8003 (KD-N), staff 8006 (S-N). Support-private groups:
 * 8b01 tickets (T-3300+n → n), 8b02 messages. Times are relative to the first boot, like the
 * console's demo clock. Idempotent (ON CONFLICT DO NOTHING): work done in the console survives restarts.
 */
export const seededId = (group: string, n: number): string =>
  `00000000-0000-7000-${group}-${String(n).padStart(12, "0")}`;

const MIN = 60_000;
const {
  TICKET_PRIORITY_URGENT: URGENT,
  TICKET_PRIORITY_HIGH: HIGH,
  TICKET_PRIORITY_NORMAL: NORMAL,
  TICKET_PRIORITY_LOW: LOW,
} = TicketPriority;
const C = TicketCategory;

/** Admin mock customers (index → C-(2040 + 7i)). */
const CUSTOMER_NAMES: Record<number, string> = {
  3: "Dilan Perera",
  5: "Arjun Mahendran",
  9: "Fathima Rizvi",
  11: "Malsha Fernando",
  14: "Chamindu Abeysinghe",
  16: "Yohan de Alwis",
  21: "Dulaj Hettiarachchi",
  24: "Nuwan Kothalawala",
  27: "Shamal Ratnayake",
};
const customer = (i: number) => ({
  kind: RequesterKind.REQUESTER_KIND_CUSTOMER,
  id: seededId("8002", 2040 + i * 7),
  name: CUSTOMER_NAMES[i]!,
});
const rider = (n: number, name: string) => ({
  kind: RequesterKind.REQUESTER_KIND_RIDER,
  id: seededId("8001", n),
  name,
});

interface SeedMessage {
  agoMin: number;
  from: MessageAuthorKind;
  author: string;
  body: string;
}

interface SeedTicket {
  n: number;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  requester: { kind: RequesterKind; id: string; name: string };
  orderNumber?: number;
  agoMin: number;
  assignee?: number;
  status?: TicketStatus;
  resolution?: string;
  body: string;
  extra?: SeedMessage[];
}

const AGENT = MessageAuthorKind.MESSAGE_AUTHOR_KIND_AGENT;
const SYSTEM = MessageAuthorKind.MESSAGE_AUTHOR_KIND_SYSTEM;

export const SEED_TICKETS: SeedTicket[] = [
  {
    n: 1,
    subject: "Order 40 minutes late, rider not answering",
    category: C.TICKET_CATEGORY_LATE,
    priority: URGENT,
    requester: customer(3),
    orderNumber: 4807,
    agoMin: 11,
    body: "My order was meant to be here at 7.20. The app still says on the way and the rider isn't picking up. Kids are waiting for dinner.",
  },
  {
    n: 2,
    subject: "Missing cheese kottu",
    category: C.TICKET_CATEGORY_MISSING_ITEM,
    priority: HIGH,
    requester: customer(5),
    orderNumber: 4798,
    agoMin: 38,
    assignee: 4,
    body: "I ordered two cheese kottu and only one came. The bag was sealed.",
    extra: [
      {
        agoMin: 31,
        from: AGENT,
        author: "Ruwani Silva",
        body: "Sorry about that, Arjun. I've asked the restaurant to check the docket. I'll come back to you within 15 minutes.",
      },
    ],
  },
  {
    n: 3,
    subject: "Charged twice for one order",
    category: C.TICKET_CATEGORY_PAYMENT,
    priority: HIGH,
    requester: customer(9),
    orderNumber: 4791,
    agoMin: 52,
    body: "I see two charges of the same amount from Kadé on my Commercial Bank card.",
  },
  {
    n: 4,
    subject: "Customer gave wrong gate, waiting 10 min",
    category: C.TICKET_CATEGORY_RIDER,
    priority: URGENT,
    requester: rider(103, "Ishara Madushan"),
    orderNumber: 4812,
    agoMin: 6,
    assignee: 1,
    body: "Address says Lauries Road but customer is at Lauries Place. Called twice, no answer. Do I wait?",
  },
  {
    n: 5,
    subject: "Got chicken biryani instead of mutton",
    category: C.TICKET_CATEGORY_WRONG_ITEM,
    priority: NORMAL,
    requester: customer(11),
    orderNumber: 4776,
    agoMin: 120,
    assignee: 5,
    body: "Ordered mutton biryani, received chicken. Paid Rs 1,950 for the mutton.",
  },
  {
    n: 6,
    subject: "Tablet keeps logging out",
    category: C.TICKET_CATEGORY_RESTAURANT,
    priority: HIGH,
    requester: {
      kind: RequesterKind.REQUESTER_KIND_RESTAURANT,
      id: seededId("8000", 7),
      name: "Wood & Fire Pizza",
    },
    agoMin: 24,
    body: "Our tablet logged out three times tonight and we missed orders. Can someone call us?",
  },
  {
    n: 7,
    subject: "Can't add a new card",
    category: C.TICKET_CATEGORY_ACCOUNT,
    priority: LOW,
    requester: customer(14),
    agoMin: 300,
    body: "When I add my Sampath card it says try again later.",
  },
  {
    n: 8,
    subject: "Food arrived cold",
    category: C.TICKET_CATEGORY_LATE,
    priority: NORMAL,
    requester: customer(16),
    orderNumber: 4769,
    agoMin: 180,
    assignee: 1,
    status: TicketStatus.TICKET_STATUS_PENDING,
    body: "The noodles were cold and soggy. Took over an hour.",
    extra: [
      {
        agoMin: 160,
        from: AGENT,
        author: "Dilini Perera",
        body: "Sorry Yohan. Could you send a photo of the food so I can sort this out with the restaurant?",
      },
      { agoMin: 159, from: SYSTEM, author: "Kadé", body: "Waiting for the customer to reply." },
    ],
  },
  {
    n: 9,
    subject: "Cash payout for last week is short",
    category: C.TICKET_CATEGORY_PAYMENT,
    priority: NORMAL,
    requester: rider(110, "Ashan de Silva"),
    agoMin: 420,
    body: "My settlement shows Rs 2,100 less than I worked out. I deposited Rs 9,750 on Thursday at BOC Wellawatte.",
  },
  {
    n: 10,
    subject: "Promo code FIRSTKOTTU not working",
    category: C.TICKET_CATEGORY_ACCOUNT,
    priority: LOW,
    requester: customer(21),
    agoMin: 540,
    assignee: 5,
    status: TicketStatus.TICKET_STATUS_RESOLVED,
    resolution: "Explained the code is for first orders only.",
    body: "It says the code only works on first orders but I've never used it.",
    extra: [
      {
        agoMin: 480,
        from: AGENT,
        author: "Imran Lafir",
        body: "Hi Dulaj, FIRSTKOTTU is for your first order on Kadé, and this account placed one in August. KADE100 still works on orders over Rs 1,000.",
      },
    ],
  },
  {
    n: 11,
    subject: "Rider was very polite, want to tip more",
    category: C.TICKET_CATEGORY_RIDER,
    priority: LOW,
    requester: customer(24),
    orderNumber: 4784,
    agoMin: 70,
    body: "Is there a way to add a tip after rating? Kasun went out of his way in the rain.",
  },
  {
    n: 12,
    subject: "Spilled curry in the bag",
    category: C.TICKET_CATEGORY_MISSING_ITEM,
    priority: HIGH,
    requester: customer(27),
    orderNumber: 4809,
    agoMin: 15,
    body: "The fish curry leaked all over the rice. Half of it is not eatable.",
  },
];

export const SEED_MACROS = [
  {
    id: "mc1",
    title: "Apology, looking into it",
    body: "Sorry about this. I'm checking with the restaurant and rider now and will reply within 15 minutes.",
  },
  {
    id: "mc2",
    title: "Refund issued",
    body: "I've refunded {amount} to your {method}. Card refunds take 5 to 7 working days to show; Kadé credit is ready to use now.",
  },
  {
    id: "mc3",
    title: "Ask for a photo",
    body: "Could you send a photo of the food and the receipt sticker on the bag? That helps us sort it out with the restaurant.",
  },
  {
    id: "mc4",
    title: "Rider: wait 5 more minutes",
    body: "Please wait 5 more minutes at the gate. I'm calling the customer now. If there's no answer, mark the order undeliverable and you'll still be paid for the trip.",
  },
  {
    id: "mc5",
    title: "Double charge: pending hold",
    body: "The second charge is a pending hold from your bank, not a payment. It drops off within 3 working days. If it's still there after that, reply here and I'll raise it with our payments team.",
  },
];

@Injectable()
export class DemoSeeder implements OnApplicationBootstrap {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.SEED_DEMO_DATA) return;
    await this.seed();
  }

  async seed(now = new Date()): Promise<void> {
    const ago = (min: number) => new Date(now.getTime() - min * MIN);
    await this.database.transaction(undefined, async (tx) => {
      await tx
        .insert(macros)
        .values(SEED_MACROS.map((m, i) => ({ ...m, position: i + 1 })))
        .onConflictDoNothing();

      const ticketRows = SEED_TICKETS.map((t) => {
        const openedAt = ago(t.agoMin);
        const firstAgent = t.extra?.find((m) => m.from === AGENT);
        const resolved = t.status === TicketStatus.TICKET_STATUS_RESOLVED;
        const assigneeName = t.assignee ? staffName(staffId(t.assignee)) : null;
        return {
          id: seededId("8b01", t.n),
          subject: t.subject,
          category: t.category,
          priority: t.priority,
          requesterKind: t.requester.kind,
          requesterId: t.requester.id,
          requesterName: t.requester.name,
          orderId: t.orderNumber ? seededId("8003", t.orderNumber) : null,
          orderNumber: t.orderNumber ? `KD-${t.orderNumber}` : null,
          channel: TicketChannel.TICKET_CHANNEL_CHAT,
          status: t.status ?? TicketStatus.TICKET_STATUS_OPEN,
          openedAt,
          slaDueAt: slaDue(openedAt, t.priority),
          firstResponseAt: firstAgent ? ago(firstAgent.agoMin) : null,
          assigneeId: t.assignee ? staffId(t.assignee) : null,
          assigneeName,
          resolution:
            resolved && t.resolution
              ? {
                  kind: ResolutionKind.RESOLUTION_KIND_NONE,
                  amountMinor: 0,
                  method: 0,
                  summary: t.resolution,
                  note: "",
                  externalRef: "",
                  resolvedBy: assigneeName ?? "Kadé support",
                  resolvedAt: ago(t.agoMin - 70).toISOString(),
                }
              : null,
          updatedAt: ago(Math.min(t.agoMin, ...(t.extra ?? []).map((m) => m.agoMin))),
        };
      });
      await tx.insert(tickets).values(ticketRows).onConflictDoNothing();

      const messageRows = SEED_TICKETS.flatMap((t) => [
        {
          id: seededId("8b02", t.n * 100 + 1),
          ticketId: seededId("8b01", t.n),
          at: ago(t.agoMin),
          fromKind: MessageAuthorKind.MESSAGE_AUTHOR_KIND_REQUESTER,
          author: t.requester.name,
          body: t.body,
          attachedOrder: null,
        },
        ...(t.extra ?? []).map((x, i) => ({
          id: seededId("8b02", t.n * 100 + 2 + i),
          ticketId: seededId("8b01", t.n),
          at: ago(x.agoMin),
          fromKind: x.from,
          author: x.author,
          body: x.body,
          attachedOrder: null,
        })),
        ...(t.status === TicketStatus.TICKET_STATUS_RESOLVED && t.resolution
          ? [
              {
                id: seededId("8b02", t.n * 100 + 99),
                ticketId: seededId("8b01", t.n),
                at: ago(t.agoMin - 70),
                fromKind: SYSTEM,
                author: "Kadé",
                body: `Resolved by ${shortName(staffName(t.assignee ? staffId(t.assignee) : undefined))}: ${t.resolution}`,
                attachedOrder: null,
              },
            ]
          : []),
      ]);
      await tx.insert(ticketMessages).values(messageRows).onConflictDoNothing();
      this.logger.info(
        { tickets: ticketRows.length, messages: messageRows.length, macros: SEED_MACROS.length },
        "demo support data seeded",
      );
    });
  }
}
