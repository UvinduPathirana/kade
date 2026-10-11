import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { orderRatings, ratingBaselines, reviews } from "../db/schema.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { syntheticBreakdown } from "../reviews/ratings.js";

/**
 * Demo data matching the apps' mocks, keyed by the shared seeded ids (docs/backend/CONVENTIONS.md,
 * "Seeded ids"). Idempotent: ON CONFLICT DO NOTHING, so replies and ratings made in the apps survive
 * restarts. Review-owned seed ids use groups 8a01 (reviews) and 8a02 (historical rated orders).
 */
export const seededId = (group: string, n: number): string =>
  `00000000-0000-7000-${group}-${String(n).padStart(12, "0")}`;

export const restaurantId = (n: number): string => seededId("8000", n);
export const NIMAL = seededId("8001", 101);

/** The customer app's restaurant cards: rating and "3k+"-style counts. */
const RESTAURANT_HISTORY: [n: number, rating: number, count: number][] = [
  [1, 4.8, 3140],
  [2, 4.9, 5210],
  [3, 4.6, 1180],
  [4, 4.7, 2260],
  [5, 4.5, 840],
  [6, 4.4, 2050],
  [7, 4.6, 1130],
  [8, 4.7, 930],
  [9, 4.8, 640],
  [10, 4.5, 720],
  [11, 4.6, 1090],
  [12, 4.9, 1240],
  [13, 4.3, 2170],
  [14, 4.7, 1060],
  [15, 4.6, 4310],
  [16, 4.4, 530],
];

const colombo = (isoDate: string, time = "20:00"): Date => new Date(`${isoDate}T${time}:00+05:30`);

interface SeedReview {
  restaurant: number;
  name: string;
  date: string;
  dish: string;
  stars: number;
  text: string;
  reply?: { text: string; at: Date };
}

/** Restaurant 1 = the restaurant app's reviews tab (rv1–rv9); the customer app shows rv1–rv3. */
export const SEED_REVIEWS: SeedReview[] = [
  {
    restaurant: 1,
    name: "Shehani",
    date: "2026-10-08",
    dish: "Cheese kottu",
    stars: 5,
    text: "Arrived hot and the cheese was still stretchy. Medium spice is properly spicy.",
  },
  {
    restaurant: 1,
    name: "Ravindu",
    date: "2026-10-03",
    dish: "Devilled chicken",
    stars: 5,
    text: "Big portion, crispy even after the ride. Ordering again on Friday.",
    reply: {
      text: "Thank you Ravindu. See you Friday, we'll keep the chilli coming.",
      at: colombo("2026-10-03", "21:10"),
    },
  },
  {
    restaurant: 1,
    name: "Aisha",
    date: "2026-09-26",
    dish: "Dolphin kottu",
    stars: 4,
    text: "Gravy came on the side so it didn't go soggy. Rider called when he reached the gate.",
  },
  {
    restaurant: 1,
    name: "Tharindu",
    date: "2026-09-24",
    dish: "Beef kottu",
    stars: 3,
    text: "Good flavour but more roti than beef this time.",
  },
  {
    restaurant: 1,
    name: "Kavindi",
    date: "2026-09-21",
    dish: "Faluda",
    stars: 5,
    text: "Best faluda on Galle Road. Packed so it didn't spill.",
    reply: { text: "Thank you Kavindi, glad it made it in one piece.", at: colombo("2026-09-21", "20:00") },
  },
  {
    restaurant: 1,
    name: "Nuwan",
    date: "2026-09-18",
    dish: "Hot butter cuttlefish",
    stars: 1,
    text: "Ordered hot butter cuttlefish, got devilled chicken. Called the restaurant, no answer.",
  },
  {
    restaurant: 1,
    name: "Fathima",
    date: "2026-09-12",
    dish: "Vegetable kottu",
    stars: 4,
    text: "Nice to have a proper vegetable kottu. Could be a bit spicier on Sri Lankan hot.",
  },
  {
    restaurant: 1,
    name: "Chamath",
    date: "2026-09-05",
    dish: "Cheese kottu",
    stars: 5,
    text: "Late night saviour. Still open at 2 am and still tastes right.",
  },
  {
    restaurant: 1,
    name: "Dilan",
    date: "2026-10-07",
    dish: "Chicken kottu",
    stars: 2,
    text: "Took over an hour on a Friday night and the kottu was lukewarm. Taste was fine.",
  },
  // Every other restaurant gets a few, so no restaurant page is empty.
  ...(
    [
      [2, "Nethmi", "2026-10-06", "Fish rice and curry", 5, "Tastes like home. The ambul thiyal is spot on."],
      [
        2,
        "Kevin",
        "2026-09-29",
        "Black pork curry",
        5,
        "Dark, rich and just enough goraka. Rice was still warm.",
      ],
      [
        2,
        "Sanduni",
        "2026-09-20",
        "Vegetable rice and curry",
        4,
        "Five curries for Rs 600 is a steal. Pol sambol could be fresher.",
      ],
      [
        3,
        "Hashan",
        "2026-10-05",
        "Fish bun",
        5,
        "Soft buns, proper spicy filling. Bought ten for the office.",
      ],
      [
        3,
        "Malsha",
        "2026-09-27",
        "Isso wade",
        4,
        "Crunchy and loaded with prawns. A bit oily by the time it came.",
      ],
      [
        4,
        "Arjun",
        "2026-10-04",
        "Mutton biryani",
        5,
        "Mutton falls off the bone. Enough for two if you're not too hungry.",
      ],
      [
        4,
        "Zainab",
        "2026-09-25",
        "Vegetable biryani",
        4,
        "Fragrant rice and plenty of cashews. Mint sambol is a must.",
      ],
      [
        5,
        "Ramesh",
        "2026-10-02",
        "Ambul thiyal with rice",
        5,
        "Proper sour fish curry. Reminds me of my aunty's in Matara.",
      ],
      [5, "Tania", "2026-09-18", "Crab curry", 4, "Messy but worth it. Bring a lot of napkins."],
      [
        6,
        "Pasan",
        "2026-10-07",
        "Double smash",
        5,
        "Crispy edges, melty cheese. Best burger in Colombo right now.",
      ],
      [
        6,
        "Rashmi",
        "2026-09-30",
        "Spicy chicken burger",
        3,
        "Good chicken but the bun was squashed in the bag.",
      ],
      [
        7,
        "Imesha",
        "2026-10-01",
        "Devilled chicken pizza",
        5,
        "Wood-fired base with devilled chicken. Why didn't anyone think of this sooner?",
      ],
      [7, "Dulaj", "2026-09-22", "Margherita", 4, "Simple and done right. Arrived a little lukewarm."],
      [
        8,
        "Anushka",
        "2026-10-03",
        "Laksa",
        5,
        "Rich coconut broth and they pack the noodles separately so nothing goes soggy.",
      ],
      [
        8,
        "Hiruni",
        "2026-09-26",
        "Gyoza",
        4,
        "Crispy bottoms, juicy filling. Would order a double portion next time.",
      ],
      [
        9,
        "Priya",
        "2026-10-06",
        "Salmon avocado roll",
        5,
        "Fresh fish and neatly packed. Feels like a treat.",
      ],
      [
        9,
        "Kaveesha",
        "2026-09-19",
        "Prawn tempura roll",
        4,
        "Tempura was still crunchy. Spicy mayo on the side please.",
      ],
      [
        10,
        "Shamal",
        "2026-10-02",
        "Chicken grain bowl",
        5,
        "Filling and healthy without tasting healthy. Gotukola is a nice touch.",
      ],
      [10, "Ishani", "2026-09-24", "Falafel bowl", 4, "Good falafel, could use more hummus."],
      [11, "Mevan", "2026-10-05", "Isso wade", 5, "Like eating on Galle Face, minus the wind."],
      [11, "Ameer", "2026-09-28", "Fish roll", 4, "Crumbed well and not greasy. Lunu miris could be hotter."],
      [
        12,
        "Oshadi",
        "2026-10-07",
        "Watalappan jar",
        5,
        "Kithul jaggery, not sugar. You can taste the difference.",
      ],
      [
        12,
        "Lakindu",
        "2026-09-21",
        "Chocolate biscuit pudding",
        5,
        "Exactly like birthday parties when I was small.",
      ],
      [
        13,
        "Sharmila",
        "2026-10-04",
        "Spicy fried chicken",
        4,
        "Crunchy and spicy. Would be perfect with a bit more salt.",
      ],
      [13, "Thisara", "2026-09-23", "Chicken wings", 3, "Tasty but only five wings in a box of six."],
      [14, "Vihanga", "2026-10-01", "Jaffna crab curry", 5, "Fiery and fragrant. Proper Jaffna style."],
      [
        14,
        "Nadia",
        "2026-09-17",
        "Mutton curry",
        4,
        "Tender mutton, lots of gravy. Order extra string hoppers.",
      ],
      [
        15,
        "Chamindu",
        "2026-10-06",
        "Weekly groceries",
        5,
        "Everything on the list and the eggs arrived unbroken.",
      ],
      [
        15,
        "Sachini",
        "2026-09-26",
        "Fresh vegetables",
        4,
        "Fresh veg, one substitution but they called first.",
      ],
      [
        16,
        "Yohan",
        "2026-10-05",
        "Glazed donuts, box of 4",
        5,
        "Soft and fresh. The cinnamon one didn't last the drive home.",
      ],
      [16, "Aisha", "2026-09-27", "Chocolate donut", 4, "Rich chocolate, slightly squashed box."],
    ] as const
  ).map(([restaurant, name, date, dish, stars, text]) => ({ restaurant, name, date, dish, stars, text })),
];

/** Rider app's ratings screen for Nimal: 4.9 from 1,284 ratings; last 100: 91/6/2/1/0. */
const NIMAL_RECENT = [
  {
    stars: 5,
    comment: "Came right up to the third floor. Thank you.",
    agoMin: 11 * 60,
    area: "Bambalapitiya",
  },
  { stars: 4, comment: "", agoMin: 11 * 60 - 5, area: "Bambalapitiya" },
  { stars: 5, comment: "Food was still hot.", agoMin: 29 * 60, area: "Cinnamon Gardens" },
  { stars: 3, comment: "Took a while to find the lane.", agoMin: 28 * 60, area: "Havelock Town" },
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
    await this.database.transaction(undefined, async (tx) => {
      const baselines = RESTAURANT_HISTORY.map(([n, rating, count]) => {
        const { breakdown, starSum } = syntheticBreakdown(rating, count);
        return { subjectKind: "restaurant", subjectId: restaurantId(n), count, starSum, breakdown };
      });
      const liveSum = NIMAL_RECENT.reduce((s, r) => s + r.stars, 0);
      baselines.push({
        subjectKind: "rider",
        subjectId: NIMAL,
        count: 1284 - NIMAL_RECENT.length,
        starSum: Math.round(4.9 * 1284) - liveSum,
        breakdown: [91, 6, 2, 1, 0],
      });
      await tx
        .insert(ratingBaselines)
        .values(
          baselines.map((b) =>
            b.subjectKind === "rider"
              ? {
                  ...b,
                  compliments: [
                    { label: "Friendly", count: 214 },
                    { label: "Careful with the food", count: 187 },
                    { label: "Fast", count: 152 },
                    { label: "Found us easily", count: 96 },
                  ],
                  improve: [
                    {
                      label: "Call when you're close",
                      detail: "3 customers asked for a call before you reached the gate.",
                    },
                    {
                      label: "Keep drinks upright",
                      detail: "One order had a leaked drink last week. Use the cup holder in your bag.",
                    },
                  ],
                }
              : b,
          ),
        )
        .onConflictDoNothing();

      await tx
        .insert(reviews)
        .values(
          SEED_REVIEWS.map((r, i) => ({
            id: seededId("8a01", i + 1),
            orderId: null,
            restaurantId: restaurantId(r.restaurant),
            customerName: r.name,
            dish: r.dish,
            stars: r.stars,
            text: r.text,
            createdAt: colombo(r.date, "19:30"),
            replyText: r.reply?.text ?? null,
            replyAt: r.reply?.at ?? null,
            replyBy: r.reply ? "Ruwan" : null,
          })),
        )
        .onConflictDoNothing();

      await tx
        .insert(orderRatings)
        .values(
          NIMAL_RECENT.map((r, i) => {
            const at = new Date(now.getTime() - r.agoMin * 60_000);
            return {
              orderId: seededId("8a02", i + 1),
              orderNumber: `KD-47${String(60 + i)}`,
              customerId: seededId("8002", 2040 + i * 7),
              restaurantId: restaurantId(1 + i),
              riderId: NIMAL,
              riderStars: r.stars,
              riderTags: [],
              restaurantStars: 0,
              comment: r.comment,
              area: r.area,
              firstRatedAt: at,
              ratedAt: at,
            };
          }),
        )
        .onConflictDoNothing();
    });
    this.logger.info({ reviews: SEED_REVIEWS.length }, "demo reviews and rating history seeded");
  }
}
