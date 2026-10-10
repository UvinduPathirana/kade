// Galle Road Kottu House's menu, the same dishes, prices and ids customers see in the customer app
// (restaurant 1). Only api/menu.ts and the order simulation read this.
import { photos as P } from "@/lib/images";
import type { Menu, MenuItem, OptionGroup } from "../types";

export const seedOptionGroups: OptionGroup[] = [
  {
    id: "spice",
    name: "Spice level",
    required: true,
    max: 1,
    choices: [
      { name: "Mild", price: 0 },
      { name: "Medium", price: 0 },
      { name: "Sri Lankan hot", price: 0 },
    ],
  },
  {
    id: "kottuExtras",
    name: "Extras",
    required: false,
    max: 4,
    choices: [
      { name: "Extra egg", price: 150 },
      { name: "Extra cheese", price: 250 },
      { name: "Extra chicken", price: 350 },
      { name: "Curry gravy on the side", price: 0 },
    ],
  },
  {
    id: "portion",
    name: "Portion",
    required: true,
    max: 1,
    choices: [
      { name: "Regular", price: 0 },
      { name: "Large", price: 400 },
    ],
  },
  {
    id: "sugar",
    name: "Sweetness",
    required: true,
    max: 1,
    choices: [
      { name: "Normal", price: 0 },
      { name: "Less sugar", price: 0 },
      { name: "No sugar", price: 0 },
    ],
  },
];

type Seed = [
  name: string,
  price: number,
  description: string,
  imageId?: string,
  extra?: Partial<Pick<MenuItem, "tags" | "optionGroupIds" | "soldOut">>,
];

const sections: Array<[string, Seed[]]> = [
  [
    "Kottu",
    [
      [
        "Chicken kottu",
        1150,
        "Chopped godamba roti on the griddle with chicken curry, egg, leeks and carrot.",
        P.kottu,
        { optionGroupIds: ["spice", "kottuExtras"], tags: ["Spicy"] },
      ],
      [
        "Cheese kottu",
        1450,
        "Chicken kottu folded through with melted cheese. The house favourite.",
        P.kottu,
        { optionGroupIds: ["spice", "kottuExtras"] },
      ],
      [
        "Dolphin kottu",
        1650,
        "Whole roti in soft strips, chicken curry gravy poured over at the table.",
        undefined,
        { optionGroupIds: ["spice", "kottuExtras"] },
      ],
      [
        "Egg kottu",
        950,
        "Roti, egg, cabbage and leeks with a little curry gravy.",
        undefined,
        { optionGroupIds: ["spice", "kottuExtras"] },
      ],
      [
        "Vegetable kottu",
        850,
        "Roti with carrot, leeks, cabbage and dhal curry.",
        undefined,
        { optionGroupIds: ["spice", "kottuExtras"], tags: ["Vegetarian"] },
      ],
      [
        "Beef kottu",
        1350,
        "Slow-cooked beef curry chopped through roti.",
        undefined,
        { optionGroupIds: ["spice", "kottuExtras"], tags: ["Spicy"] },
      ],
      [
        "String hopper kottu",
        1250,
        "String hoppers chopped with chicken, egg and onion.",
        undefined,
        { optionGroupIds: ["spice"], soldOut: true },
      ],
    ],
  ],
  [
    "Rice and noodles",
    [
      [
        "Chicken fried rice",
        1100,
        "Basmati fried with egg, vegetables and chilli paste on the side.",
        P.friedRice,
        { optionGroupIds: ["portion"] },
      ],
      [
        "Nasi goreng",
        1350,
        "Sweet-spicy fried rice with a fried egg and chicken satay.",
        P.tomatoDish,
        { optionGroupIds: ["portion"] },
      ],
      [
        "Seafood noodles",
        1500,
        "Egg noodles with prawns, cuttlefish and spring onion.",
        P.noodleSoup,
        { optionGroupIds: ["spice"] },
      ],
    ],
  ],
  [
    "Devilled",
    [
      [
        "Devilled chicken",
        1400,
        "Crispy chicken tossed with onion, capsicum and chilli sauce.",
        P.chicken,
        { optionGroupIds: ["spice"], tags: ["Spicy"] },
      ],
      [
        "Hot butter cuttlefish",
        1650,
        "Battered cuttlefish fried with butter, garlic and dried chilli.",
        P.sizzler,
        { optionGroupIds: ["spice"] },
      ],
      [
        "Devilled prawns",
        1900,
        "Tiger prawns in a sticky tomato and chilli sauce.",
        P.gravy,
        { optionGroupIds: ["spice"], tags: ["Spicy"] },
      ],
    ],
  ],
  [
    "Short eats",
    [
      ["Fish roll", 180, "Crumbed pancake roll filled with spiced fish and potato.", P.samosa],
      ["Chicken patty", 160, "Flaky pastry half-moon with curried chicken.", P.buns],
      ["Egg roti", 220, "Thin roti folded around an egg, with lunu miris."],
    ],
  ],
  [
    "Drinks and dessert",
    [
      [
        "Faluda",
        450,
        "Rose syrup, milk, basil seeds and a scoop of ice cream.",
        P.pudding,
        { optionGroupIds: ["sugar"] },
      ],
      ["Iced Milo", 400, "Made strong, the way the kades do it.", undefined, { optionGroupIds: ["sugar"] }],
      [
        "Woodapple juice",
        380,
        "Fresh woodapple blended with jaggery.",
        undefined,
        { optionGroupIds: ["sugar"], tags: ["Vegetarian"] },
      ],
      [
        "Watalappan",
        350,
        "Kithul jaggery and coconut custard with cashews.",
        undefined,
        { tags: ["Vegetarian"] },
      ],
    ],
  ],
];

/** Ids follow the customer app ("1-<section>-<item>") so a dish is the same product on both sides. */
export function seedMenu(): Menu {
  return {
    optionGroups: seedOptionGroups,
    sections: sections.map(([name, seeds], s) => ({
      id: `s${s}`,
      name,
      items: seeds.map(([itemName, price, description, imageId, extra = {}], i) => ({
        id: `1-${s}-${i}`,
        name: itemName,
        price,
        description,
        imageId,
        tags: extra.tags ?? [],
        optionGroupIds: extra.optionGroupIds ?? [],
        soldOut: extra.soldOut ?? false,
      })),
    })),
  };
}
