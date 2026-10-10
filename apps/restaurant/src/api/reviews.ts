// Reviews API. Today a mock in localStorage; later the review service
// (GET /outlets/:id/reviews, PUT /reviews/:id/reply). One public reply per review, editable.
import { latency, readJson, ServiceError, writeJson } from "./storage";
import type { Review } from "./types";

const KEY = "kade.partner.reviews.v1";

const seed = (): Review[] => [
  {
    id: "rv1",
    name: "Shehani",
    date: "2026-10-08",
    dish: "Cheese kottu",
    stars: 5,
    text: "Arrived hot and the cheese was still stretchy. Medium spice is properly spicy.",
  },
  {
    id: "rv9",
    name: "Dilan",
    date: "2026-10-07",
    dish: "Chicken kottu",
    stars: 2,
    text: "Took over an hour on a Friday night and the kottu was lukewarm. Taste was fine.",
  },
  {
    id: "rv2",
    name: "Ravindu",
    date: "2026-10-03",
    dish: "Devilled chicken",
    stars: 5,
    text: "Big portion, crispy even after the ride. Ordering again on Friday.",
    reply: {
      text: "Thank you Ravindu. See you Friday, we'll keep the chilli coming.",
      at: Date.parse("2026-10-03T21:10:00+05:30"),
    },
  },
  {
    id: "rv3",
    name: "Aisha",
    date: "2026-09-26",
    dish: "Dolphin kottu",
    stars: 4,
    text: "Gravy came on the side so it didn't go soggy. Rider called when he reached the gate.",
  },
  {
    id: "rv4",
    name: "Tharindu",
    date: "2026-09-24",
    dish: "Beef kottu",
    stars: 3,
    text: "Good flavour but more roti than beef this time.",
  },
  {
    id: "rv5",
    name: "Kavindi",
    date: "2026-09-21",
    dish: "Faluda",
    stars: 5,
    text: "Best faluda on Galle Road. Packed so it didn't spill.",
    reply: {
      text: "Thank you Kavindi, glad it made it in one piece.",
      at: Date.parse("2026-09-21T20:00:00+05:30"),
    },
  },
  {
    id: "rv6",
    name: "Nuwan",
    date: "2026-09-18",
    dish: "Hot butter cuttlefish",
    stars: 1,
    text: "Ordered hot butter cuttlefish, got devilled chicken. Called the restaurant, no answer.",
  },
  {
    id: "rv7",
    name: "Fathima",
    date: "2026-09-12",
    dish: "Vegetable kottu",
    stars: 4,
    text: "Nice to have a proper vegetable kottu. Could be a bit spicier on Sri Lankan hot.",
  },
  {
    id: "rv8",
    name: "Chamath",
    date: "2026-09-05",
    dish: "Cheese kottu",
    stars: 5,
    text: "Late night saviour. Still open at 2 am and still tastes right.",
  },
];

const read = () => readJson<Review[]>(KEY, seed);

export async function listReviews(): Promise<Review[]> {
  await latency(150);
  return structuredClone(read());
}

/** Posts or replaces the outlet's reply. An empty reply removes it. */
export async function replyToReview({ id, text }: { id: string; text: string }): Promise<Review> {
  await latency();
  const all = read();
  const review = all.find((r) => r.id === id);
  if (!review) throw new ServiceError("This review has been removed.");
  if (text.trim()) review.reply = { text: text.trim(), at: Date.now() };
  else delete review.reply;
  writeJson(KEY, all);
  return review;
}
