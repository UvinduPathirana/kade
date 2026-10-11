// Seed data: exactly the customer app's mock catalogue (apps/customer/src/api/mock/catalogue.ts),
// plus zone/cuisine from the admin mock (apps/admin/src/api/mock/partners.ts), Galle Road Kottu
// House's hours and closures from the restaurant app (apps/restaurant/src/api/outlet.ts), and the
// home collections from apps/admin/src/api/mock/backOffice.ts. Prices here are whole rupees, as in
// the mocks; the seeder converts them to minor units.

export const photos = {
  kottu: "1589302168068-964664d93dc0",
  biryani: "1563379091339-03b21ab4a4f8",
  curry: "1585937421612-70a008356fbe",
  curry2: "1596797038530-2c107229654b",
  curry3: "1631452180519-c014fe946bc7",
  fishCurry: "1574484284002-952d92456975",
  gravy: "1565557623262-b51c2513a641",
  samosa: "1601050690597-df0568f70950",
  buns: "1606491956689-2ea866880c84",
  chaat: "1610192244261-3f33de3f55e4",
  friedRice: "1603133872878-684f208fb84b",
  noodleSoup: "1559847844-5315695dadae",
  ramen: "1569718212165-3a8278d5f624",
  laksa: "1617093727343-374698b1b08d",
  sushi: "1579871494447-9811cf80d66c",
  burger: "1568901346375-23c9450c58cd",
  chicken: "1626074353765-517a681e40be",
  sizzler: "1567188040759-fb8a883dc6d8",
  grill: "1555939594-58d7cb561ad1",
  tomatoDish: "1645177628172-a94c1f96e6db",
  pizza: "1513104890138-7c749659a591",
  pizza2: "1565299624946-b28f40a0ae38",
  salad: "1512621776951-a57141f2eefd",
  bowl: "1546069901-ba9599a7e63c",
  salad2: "1540189549336-e6e99c3679fe",
  soup: "1547592180-85f173990554",
  spread: "1504674900247-0877df9cc836",
  donut: "1551024601-bec78aea704b",
  pudding: "1488477181946-6428a0291777",
  grocery: "1542838132-92c53300491e",
} as const;
const P = photos;

export const seedCategories: { id: string; label: string; imageId: string }[] = [
  { id: "all", label: "All", imageId: P.spread },
  { id: "rice", label: "Rice & curry", imageId: P.curry },
  { id: "kottu", label: "Kottu", imageId: P.kottu },
  { id: "shorteats", label: "Short eats", imageId: P.samosa },
  { id: "biryani", label: "Biryani", imageId: P.biryani },
  { id: "seafood", label: "Seafood", imageId: P.fishCurry },
  { id: "burgers", label: "Burgers", imageId: P.burger },
  { id: "pizza", label: "Pizza", imageId: P.pizza },
  { id: "asian", label: "Noodles & ramen", imageId: P.ramen },
  { id: "sushi", label: "Sushi", imageId: P.sushi },
  { id: "healthy", label: "Salads & bowls", imageId: P.bowl },
  { id: "dessert", label: "Desserts", imageId: P.donut },
  { id: "grocery", label: "Grocery", imageId: P.grocery },
];

export interface SeedRestaurant {
  id: number;
  name: string;
  categoryId: string;
  imageId: string;
  eta: [number, number];
  /** Rupees; 0 = free delivery. */
  deliveryFee: number;
  rating: number;
  ratingCount: number;
  priceLevel: number;
  offer?: string;
  discountPercent?: number;
  hasVegetarian: boolean;
  area: string;
  /** Distance from the reference address (Home, 42 Galle Rd, Colombo 03) in the mock. */
  distanceKm: number;
  hours: string;
  zoneId: string;
  cuisine: string;
  address: string;
  phone: string;
  /** Map units of the area the restaurant is placed towards (customer app map). */
  towards: [number, number];
}

const KOLLUPITIYA: [number, number] = [430, 560];
const BAMBALAPITIYA: [number, number] = [364, 742];
const SLAVE_ISLAND: [number, number] = [430, 330];
const WELLAWATTE: [number, number] = [372, 982];
const DEHIWALA: [number, number] = [392, 1236];
const CINNAMON_GARDENS: [number, number] = [600, 600];
const GALLE_FACE: [number, number] = [300, 250];
const COLOMBO_03: [number, number] = [420, 470];
const COLOMBO_04: [number, number] = [420, 760];

export const seedRestaurants: SeedRestaurant[] = [
  {
    id: 1,
    name: "Galle Road Kottu House",
    categoryId: "kottu",
    imageId: P.kottu,
    eta: [15, 25],
    deliveryFee: 150,
    rating: 4.8,
    ratingCount: 3000,
    priceLevel: 1,
    offer: "20% off kottu",
    discountPercent: 20,
    hasVegetarian: false,
    area: "Kollupitiya",
    distanceKm: 1.2,
    hours: "11 am – 2 am",
    zoneId: "c03",
    cuisine: "Kottu",
    address: "312 Galle Road, Colombo 03",
    phone: "+94 11 257 4410",
    towards: KOLLUPITIYA,
  },
  {
    id: 2,
    name: "Amma's Rice & Curry",
    categoryId: "rice",
    imageId: P.curry,
    eta: [20, 30],
    deliveryFee: 0,
    rating: 4.9,
    ratingCount: 5000,
    priceLevel: 1,
    hasVegetarian: true,
    area: "Bambalapitiya",
    distanceKm: 1.8,
    hours: "10 am – 10 pm",
    zoneId: "c04",
    cuisine: "Rice and curry",
    address: "57 Lauries Road, Colombo 04",
    phone: "+94 11 258 3321",
    towards: BAMBALAPITIYA,
  },
  {
    id: 3,
    name: "Kompanna Short Eats",
    categoryId: "shorteats",
    imageId: P.buns,
    eta: [10, 20],
    deliveryFee: 120,
    rating: 4.6,
    ratingCount: 1000,
    priceLevel: 1,
    offer: "Buy 5, get 2 free",
    hasVegetarian: false,
    area: "Slave Island",
    distanceKm: 0.9,
    hours: "7 am – 9 pm",
    zoneId: "c02",
    cuisine: "Short eats",
    address: "14 Malay Street, Colombo 02",
    phone: "+94 11 243 8812",
    towards: SLAVE_ISLAND,
  },
  {
    id: 4,
    name: "Marine Drive Biryani",
    categoryId: "biryani",
    imageId: P.biryani,
    eta: [25, 35],
    deliveryFee: 200,
    rating: 4.7,
    ratingCount: 2000,
    priceLevel: 2,
    offer: "Rs 300 off Rs 2,500+",
    hasVegetarian: false,
    area: "Wellawatte",
    distanceKm: 3.1,
    hours: "11 am – 11 pm",
    zoneId: "c06",
    cuisine: "Biryani",
    address: "220 Marine Drive, Colombo 06",
    phone: "+94 11 236 9045",
    towards: WELLAWATTE,
  },
  {
    id: 5,
    name: "Negombo Fish Curry Co.",
    categoryId: "seafood",
    imageId: P.fishCurry,
    eta: [30, 40],
    deliveryFee: 250,
    rating: 4.5,
    ratingCount: 800,
    priceLevel: 2,
    hasVegetarian: false,
    area: "Dehiwala",
    distanceKm: 4.4,
    hours: "11 am – 10 pm",
    zoneId: "deh",
    cuisine: "Seafood",
    address: "88 Galle Road, Dehiwala",
    phone: "+94 11 271 6630",
    towards: DEHIWALA,
  },
  {
    id: 6,
    name: "Smash Shed",
    categoryId: "burgers",
    imageId: P.burger,
    eta: [20, 30],
    deliveryFee: 0,
    rating: 4.4,
    ratingCount: 2000,
    priceLevel: 2,
    offer: "Free fries over Rs 2,000",
    hasVegetarian: false,
    area: "Kollupitiya",
    distanceKm: 1.4,
    hours: "12 pm – 1 am",
    zoneId: "c03",
    cuisine: "Burgers",
    address: "9 Alfred House Gardens, Colombo 03",
    phone: "+94 77 410 2288",
    towards: KOLLUPITIYA,
  },
  {
    id: 7,
    name: "Wood & Fire Pizza",
    categoryId: "pizza",
    imageId: P.pizza,
    eta: [30, 45],
    deliveryFee: 180,
    rating: 4.6,
    ratingCount: 1000,
    priceLevel: 3,
    hasVegetarian: true,
    area: "Cinnamon Gardens",
    distanceKm: 2.6,
    hours: "12 pm – 11 pm",
    zoneId: "c07",
    cuisine: "Pizza",
    address: "41 Ward Place, Colombo 07",
    phone: "+94 11 269 4417",
    towards: CINNAMON_GARDENS,
  },
  {
    id: 8,
    name: "Noodle Lane",
    categoryId: "asian",
    imageId: P.ramen,
    eta: [25, 35],
    deliveryFee: 150,
    rating: 4.7,
    ratingCount: 900,
    priceLevel: 2,
    offer: "15% off ramen",
    discountPercent: 15,
    hasVegetarian: false,
    area: "Bambalapitiya",
    distanceKm: 2.0,
    hours: "11 am – 11 pm",
    zoneId: "c04",
    cuisine: "Noodles and ramen",
    address: "112 Duplication Road, Colombo 04",
    phone: "+94 11 250 7781",
    towards: BAMBALAPITIYA,
  },
  {
    id: 9,
    name: "Sakura Colombo",
    categoryId: "sushi",
    imageId: P.sushi,
    eta: [35, 50],
    deliveryFee: 300,
    rating: 4.8,
    ratingCount: 600,
    priceLevel: 3,
    hasVegetarian: false,
    area: "Colombo 07",
    distanceKm: 3.5,
    hours: "12 pm – 10 pm",
    zoneId: "c07",
    cuisine: "Sushi",
    address: "6 Horton Place, Colombo 07",
    phone: "+94 11 268 1290",
    towards: CINNAMON_GARDENS,
  },
  {
    id: 10,
    name: "Green Cabin Bowls",
    categoryId: "healthy",
    imageId: P.salad,
    eta: [15, 25],
    deliveryFee: 0,
    rating: 4.5,
    ratingCount: 700,
    priceLevel: 2,
    hasVegetarian: true,
    area: "Kollupitiya",
    distanceKm: 1.1,
    hours: "8 am – 9 pm",
    zoneId: "c03",
    cuisine: "Salads and bowls",
    address: "453 Galle Road, Colombo 03",
    phone: "+94 77 302 5514",
    towards: KOLLUPITIYA,
  },
  {
    id: 11,
    name: "Pettah Isso Wade",
    categoryId: "shorteats",
    imageId: P.chaat,
    eta: [20, 30],
    deliveryFee: 100,
    rating: 4.6,
    ratingCount: 1000,
    priceLevel: 1,
    hasVegetarian: false,
    area: "Galle Face",
    distanceKm: 1.6,
    hours: "3 pm – 11 pm",
    zoneId: "c01",
    cuisine: "Short eats",
    address: "Galle Face Promenade, Colombo 01",
    phone: "+94 77 655 2109",
    towards: GALLE_FACE,
  },
  {
    id: 12,
    name: "Watalappan Bar",
    categoryId: "dessert",
    imageId: P.pudding,
    eta: [15, 25],
    deliveryFee: 120,
    rating: 4.9,
    ratingCount: 1000,
    priceLevel: 1,
    offer: "2 for Rs 900",
    hasVegetarian: true,
    area: "Colombo 03",
    distanceKm: 1.0,
    hours: "10 am – 11 pm",
    zoneId: "c03",
    cuisine: "Desserts",
    address: "28 Flower Road, Colombo 03",
    phone: "+94 11 257 9902",
    towards: COLOMBO_03,
  },
  {
    id: 13,
    name: "Ceylon Fried Chicken",
    categoryId: "burgers",
    imageId: P.chicken,
    eta: [20, 30],
    deliveryFee: 150,
    rating: 4.3,
    ratingCount: 2000,
    priceLevel: 1,
    hasVegetarian: false,
    area: "Bambalapitiya",
    distanceKm: 2.2,
    hours: "11 am – 12 am",
    zoneId: "c04",
    cuisine: "Fried chicken",
    address: "301 Galle Road, Colombo 04",
    phone: "+94 11 259 6630",
    towards: BAMBALAPITIYA,
  },
  {
    id: 14,
    name: "Jaffna Curry Pot",
    categoryId: "rice",
    imageId: P.curry2,
    eta: [30, 40],
    deliveryFee: 200,
    rating: 4.7,
    ratingCount: 1000,
    priceLevel: 1,
    hasVegetarian: false,
    area: "Wellawatte",
    distanceKm: 3.3,
    hours: "11 am – 10 pm",
    zoneId: "c06",
    cuisine: "Rice and curry",
    address: "35 Station Road, Colombo 06",
    phone: "+94 11 236 4478",
    towards: WELLAWATTE,
  },
  {
    id: 15,
    name: "Kadé Market",
    categoryId: "grocery",
    imageId: P.grocery,
    eta: [20, 35],
    deliveryFee: 0,
    rating: 4.6,
    ratingCount: 4000,
    priceLevel: 1,
    offer: "Rs 500 off first shop",
    hasVegetarian: true,
    area: "Colombo 03",
    distanceKm: 0.8,
    hours: "6 am – 12 am",
    zoneId: "c03",
    cuisine: "Grocery",
    address: "75 Dharmapala Mawatha, Colombo 03",
    phone: "+94 11 200 4000",
    towards: COLOMBO_03,
  },
  {
    id: 16,
    name: "Donut Republic",
    categoryId: "dessert",
    imageId: P.donut,
    eta: [15, 25],
    deliveryFee: 150,
    rating: 4.4,
    ratingCount: 500,
    priceLevel: 1,
    hasVegetarian: true,
    area: "Colombo 04",
    distanceKm: 2.4,
    hours: "8 am – 8 pm",
    zoneId: "c04",
    cuisine: "Desserts",
    address: "18 Bagatalle Road, Colombo 04",
    phone: "+94 77 588 3140",
    towards: COLOMBO_04,
  },
];

/** The customer app's "Home" address pin (42 Galle Rd, Colombo 03): mock distances are from here. */
export const REFERENCE_PIN: [number, number] = [352, 500];

/** Galle Road Kottu House: the restaurant app's richer week and Poya closures. */
export const restaurantOneHours = [
  { day: 1, isOpen: true, ranges: [{ open: "11:00", close: "02:00" }] },
  { day: 2, isOpen: true, ranges: [{ open: "11:00", close: "02:00" }] },
  { day: 3, isOpen: true, ranges: [{ open: "11:00", close: "02:00" }] },
  { day: 4, isOpen: true, ranges: [{ open: "11:00", close: "02:00" }] },
  { day: 5, isOpen: true, ranges: [{ open: "11:00", close: "03:00" }] },
  { day: 6, isOpen: true, ranges: [{ open: "11:00", close: "03:00" }] },
  {
    day: 7,
    isOpen: true,
    ranges: [
      { open: "11:00", close: "15:00" },
      { open: "18:00", close: "02:00" },
    ],
  },
];
export const restaurantOneClosures = [
  { n: 1, date: "2026-10-26", reason: "Vap Poya" },
  { n: 2, date: "2026-11-24", reason: "Il Poya" },
  { n: 3, date: "2026-12-23", reason: "Unduvap Poya" },
];

// ---------- Option groups (per restaurant; only the ones its menu uses are seeded) ----------

export type OptionKey =
  "spice" | "kottuExtras" | "portion" | "pizzaSize" | "burgerExtras" | "sugar" | "sides";

/** Order fixes the seeded id (group 8012, G = index + 1). */
export const OPTION_GROUP_ORDER: OptionKey[] = [
  "spice",
  "kottuExtras",
  "portion",
  "pizzaSize",
  "burgerExtras",
  "sugar",
  "sides",
];

export const seedOptionGroups: Record<
  OptionKey,
  { name: string; required: boolean; max: number; choices: [string, number][] }
> = {
  spice: {
    name: "Spice level",
    required: true,
    max: 1,
    choices: [
      ["Mild", 0],
      ["Medium", 0],
      ["Sri Lankan hot", 0],
    ],
  },
  kottuExtras: {
    name: "Extras",
    required: false,
    max: 4,
    choices: [
      ["Extra egg", 150],
      ["Extra cheese", 250],
      ["Extra chicken", 350],
      ["Curry gravy on the side", 0],
    ],
  },
  portion: {
    name: "Portion",
    required: true,
    max: 1,
    choices: [
      ["Regular", 0],
      ["Large", 400],
    ],
  },
  pizzaSize: {
    name: "Size",
    required: true,
    max: 1,
    choices: [
      ["Medium, 10 inch", 0],
      ["Large, 14 inch", 900],
    ],
  },
  burgerExtras: {
    name: "Add to your burger",
    required: false,
    max: 3,
    choices: [
      ["Cheese slice", 200],
      ["Fried egg", 150],
      ["Bacon", 350],
    ],
  },
  sugar: {
    name: "Sweetness",
    required: true,
    max: 1,
    choices: [
      ["Normal", 0],
      ["Less sugar", 0],
      ["No sugar", 0],
    ],
  },
  sides: {
    name: "Add a side",
    required: false,
    max: 2,
    choices: [
      ["Papadam", 80],
      ["Seeni sambol", 120],
      ["Pol sambol", 100],
    ],
  },
};

// ---------- Menus (one template per category, as the mock's buildMenu does) ----------

export type SeedTag = "Vegetarian" | "Spicy";

export interface SeedItem {
  name: string;
  price: number;
  description: string;
  imageId?: string;
  popularRank?: number;
  options?: OptionKey[];
  tags?: SeedTag[];
  soldOut?: boolean;
  unit?: string;
}

const I = (
  name: string,
  price: number,
  description: string,
  imageId?: string,
  extra: Partial<SeedItem> = {},
): SeedItem => ({ name, price, description, imageId, ...extra });

const G = (name: string, price: number, unit: string, description: string, extra: Partial<SeedItem> = {}) =>
  I(name, price, description, undefined, { unit, ...extra });

export const menuTemplates: Record<string, Array<[string, SeedItem[]]>> = {
  kottu: [
    [
      "Kottu",
      [
        I(
          "Chicken kottu",
          1150,
          "Chopped godamba roti on the griddle with chicken curry, egg, leeks and carrot.",
          P.kottu,
          { popularRank: 1, options: ["spice", "kottuExtras"], tags: ["Spicy"] },
        ),
        I(
          "Cheese kottu",
          1450,
          "Chicken kottu folded through with melted cheese. The house favourite.",
          P.kottu,
          {
            popularRank: 2,
            options: ["spice", "kottuExtras"],
          },
        ),
        I(
          "Dolphin kottu",
          1650,
          "Whole roti in soft strips, chicken curry gravy poured over at the table.",
          undefined,
          {
            options: ["spice", "kottuExtras"],
          },
        ),
        I("Egg kottu", 950, "Roti, egg, cabbage and leeks with a little curry gravy.", undefined, {
          options: ["spice", "kottuExtras"],
        }),
        I("Vegetable kottu", 850, "Roti with carrot, leeks, cabbage and dhal curry.", undefined, {
          options: ["spice", "kottuExtras"],
          tags: ["Vegetarian"],
        }),
        I("Beef kottu", 1350, "Slow-cooked beef curry chopped through roti.", undefined, {
          options: ["spice", "kottuExtras"],
          tags: ["Spicy"],
        }),
        I("String hopper kottu", 1250, "String hoppers chopped with chicken, egg and onion.", undefined, {
          options: ["spice"],
          soldOut: true,
        }),
      ],
    ],
    [
      "Rice and noodles",
      [
        I(
          "Chicken fried rice",
          1100,
          "Basmati fried with egg, vegetables and chilli paste on the side.",
          P.friedRice,
          {
            options: ["portion"],
          },
        ),
        I("Nasi goreng", 1350, "Sweet-spicy fried rice with a fried egg and chicken satay.", P.tomatoDish, {
          options: ["portion"],
        }),
        I("Seafood noodles", 1500, "Egg noodles with prawns, cuttlefish and spring onion.", P.noodleSoup, {
          options: ["spice"],
        }),
      ],
    ],
    [
      "Devilled",
      [
        I(
          "Devilled chicken",
          1400,
          "Crispy chicken tossed with onion, capsicum and chilli sauce.",
          P.chicken,
          {
            popularRank: 3,
            options: ["spice"],
            tags: ["Spicy"],
          },
        ),
        I(
          "Hot butter cuttlefish",
          1650,
          "Battered cuttlefish fried with butter, garlic and dried chilli.",
          P.sizzler,
          {
            options: ["spice"],
          },
        ),
        I("Devilled prawns", 1900, "Tiger prawns in a sticky tomato and chilli sauce.", P.gravy, {
          options: ["spice"],
          tags: ["Spicy"],
        }),
      ],
    ],
    [
      "Short eats",
      [
        I("Fish roll", 180, "Crumbed pancake roll filled with spiced fish and potato.", P.samosa),
        I("Chicken patty", 160, "Flaky pastry half-moon with curried chicken.", P.buns),
        I("Egg roti", 220, "Thin roti folded around an egg, with lunu miris."),
      ],
    ],
    [
      "Drinks and dessert",
      [
        I("Faluda", 450, "Rose syrup, milk, basil seeds and a scoop of ice cream.", P.pudding, {
          popularRank: 4,
          options: ["sugar"],
        }),
        I("Iced Milo", 400, "Made strong, the way the kades do it.", undefined, { options: ["sugar"] }),
        I("Woodapple juice", 380, "Fresh woodapple blended with jaggery.", undefined, {
          options: ["sugar"],
          tags: ["Vegetarian"],
        }),
        I("Watalappan", 350, "Kithul jaggery and coconut custard with cashews.", undefined, {
          tags: ["Vegetarian"],
        }),
      ],
    ],
  ],
  rice: [
    [
      "Rice and curry",
      [
        I(
          "Chicken rice and curry",
          750,
          "Red rice, chicken curry, dhal, beans, mallung and papadam.",
          P.curry,
          {
            popularRank: 1,
            options: ["portion", "sides"],
          },
        ),
        I("Fish rice and curry", 800, "Red rice, ambul thiyal, dhal, brinjal moju and greens.", P.fishCurry, {
          popularRank: 2,
          options: ["portion", "sides"],
        }),
        I("Vegetable rice and curry", 600, "Red rice with five vegetable curries and pol sambol.", P.curry2, {
          options: ["portion", "sides"],
          tags: ["Vegetarian"],
        }),
        I(
          "Lamprais",
          1350,
          "Rice cooked in stock with frikkadel, seeni sambol and blachan, baked in a banana leaf.",
          undefined,
          { options: ["sides"] },
        ),
      ],
    ],
    [
      "Curries on their own",
      [
        I("Black pork curry", 1100, "Roasted spices and goraka, cooked down until dark.", P.curry3, {
          popularRank: 3,
          tags: ["Spicy"],
        }),
        I("Jackfruit curry", 550, "Young polos curry in coconut milk.", undefined, { tags: ["Vegetarian"] }),
        I("Parippu", 300, "Red lentils tempered with mustard seed and curry leaves.", undefined, {
          tags: ["Vegetarian"],
        }),
      ],
    ],
  ],
  shorteats: [
    [
      "Short eats",
      [
        I("Fish bun", 140, "Soft triangle bun with spiced fish and potato.", P.buns, { popularRank: 1 }),
        I("Vegetable roti", 120, "Triangle roti with curried potato and leeks.", undefined, {
          popularRank: 2,
          tags: ["Vegetarian"],
        }),
        I("Chicken patty", 160, "Flaky pastry half-moon with curried chicken.", P.samosa, { popularRank: 3 }),
        I("Isso wade", 250, "Lentil fritter topped with whole prawns.", P.chaat),
      ],
    ],
    [
      "Sweet",
      [
        I("Kimbula bun", 120, "Crocodile-shaped sugar bun.", undefined, { tags: ["Vegetarian"] }),
        I("Love cake slice", 300, "Semolina, cashew and pumpkin preserve.", undefined, {
          tags: ["Vegetarian"],
        }),
      ],
    ],
  ],
  biryani: [
    [
      "Biryani",
      [
        I(
          "Chicken biryani",
          1450,
          "Dum-cooked basmati, chicken leg, boiled egg, raita and mint sambol.",
          P.biryani,
          {
            popularRank: 1,
            options: ["portion"],
          },
        ),
        I("Mutton biryani", 1900, "Bone-in mutton, fried onions, cashews and sultanas.", P.biryani, {
          popularRank: 2,
          options: ["portion"],
        }),
        I("Vegetable biryani", 1100, "Paneer, peas and carrot with saffron rice.", undefined, {
          options: ["portion"],
          tags: ["Vegetarian"],
        }),
      ],
    ],
    [
      "Sides",
      [
        I("Wattalappam", 350, "Jaggery coconut custard.", P.pudding),
        I("Mint sambol", 150, "Fresh mint, coconut and green chilli.", undefined, { tags: ["Vegetarian"] }),
      ],
    ],
  ],
  seafood: [
    [
      "From the lagoon",
      [
        I("Ambul thiyal with rice", 1600, "Sour tuna curry with goraka, served with red rice.", P.fishCurry, {
          popularRank: 1,
          options: ["spice"],
        }),
        I("Crab curry", 3200, "Lagoon crab in a Jaffna-style curry.", P.curry3, {
          popularRank: 2,
          options: ["spice"],
          tags: ["Spicy"],
        }),
        I("Prawn curry", 2100, "Tiger prawns in coconut milk and chilli.", P.gravy, { options: ["spice"] }),
      ],
    ],
    [
      "Grilled",
      [
        I("Grilled seer fish", 2400, "With garlic butter, salad and chips.", P.grill),
        I("Cuttlefish skewers", 1500, "Three skewers with lime and chilli salt.", P.sizzler),
      ],
    ],
  ],
  burgers: [
    [
      "Burgers",
      [
        I("Double smash", 1850, "Two beef patties, cheese, pickles and house sauce.", P.burger, {
          popularRank: 1,
          options: ["burgerExtras"],
        }),
        I("Spicy chicken burger", 1550, "Fried thigh, lunu miris mayo and slaw.", P.chicken, {
          popularRank: 2,
          options: ["burgerExtras"],
          tags: ["Spicy"],
        }),
        I("Mushroom burger", 1450, "Portobello, cheese and caramelised onion.", undefined, {
          options: ["burgerExtras"],
          tags: ["Vegetarian"],
        }),
      ],
    ],
    [
      "Sides",
      [
        I("Fries", 550, "Skin-on, salted.", undefined, { popularRank: 3, tags: ["Vegetarian"] }),
        I("Chicken wings", 1200, "Six wings, devilled or honey chilli.", P.chicken, { options: ["spice"] }),
      ],
    ],
  ],
  pizza: [
    [
      "Pizza",
      [
        I("Margherita", 2200, "Tomato, mozzarella and basil.", P.pizza2, {
          popularRank: 1,
          options: ["pizzaSize"],
          tags: ["Vegetarian"],
        }),
        I("Devilled chicken pizza", 2800, "Devilled chicken, onion, capsicum and green chilli.", P.pizza, {
          popularRank: 2,
          options: ["pizzaSize"],
          tags: ["Spicy"],
        }),
        I("Four cheese", 2900, "Mozzarella, cheddar, parmesan and blue.", undefined, {
          options: ["pizzaSize"],
          tags: ["Vegetarian"],
        }),
      ],
    ],
    [
      "Salads",
      [
        I("Garden salad", 1100, "Leaves, cucumber, tomato and vinaigrette.", P.salad2, {
          tags: ["Vegetarian"],
        }),
      ],
    ],
  ],
  asian: [
    [
      "Ramen and noodles",
      [
        I("Chicken shoyu ramen", 1900, "Soy broth, chashu chicken, egg and nori.", P.ramen, {
          popularRank: 1,
          options: ["spice"],
        }),
        I("Laksa", 1800, "Coconut curry broth, prawns and rice noodles.", P.laksa, {
          popularRank: 2,
          options: ["spice"],
          tags: ["Spicy"],
        }),
        I("Dan dan noodles", 1500, "Sesame, chilli oil and minced chicken.", P.noodleSoup, {
          options: ["spice"],
        }),
      ],
    ],
    [
      "Small plates",
      [
        I("Gyoza", 950, "Six pan-fried chicken dumplings."),
        I("Edamame", 650, "Sea salt.", undefined, { tags: ["Vegetarian"] }),
      ],
    ],
  ],
  sushi: [
    [
      "Rolls",
      [
        I("Salmon avocado roll", 2400, "Eight pieces.", P.sushi, { popularRank: 1 }),
        I("Prawn tempura roll", 2200, "Eight pieces with spicy mayo.", P.sushi, { popularRank: 2 }),
        I("Cucumber roll", 1200, "Six pieces.", undefined, { tags: ["Vegetarian"] }),
      ],
    ],
    ["Bowls", [I("Poke bowl", 2600, "Tuna, rice, edamame and sesame.", P.bowl)]],
  ],
  healthy: [
    [
      "Bowls",
      [
        I("Chicken grain bowl", 1650, "Red rice, grilled chicken, gotukola and tahini.", P.bowl, {
          popularRank: 1,
        }),
        I("Falafel bowl", 1450, "Falafel, hummus, pickles and greens.", P.salad, {
          popularRank: 2,
          tags: ["Vegetarian"],
        }),
        I("Gotukola sambol salad", 950, "Pennywort, coconut, lime and red onion.", P.salad2, {
          tags: ["Vegetarian"],
        }),
      ],
    ],
    [
      "Soups",
      [I("Kola kenda", 450, "Herbal porridge with jaggery on the side.", P.soup, { tags: ["Vegetarian"] })],
    ],
  ],
  dessert: [
    [
      "Desserts",
      [
        I("Watalappan jar", 450, "Kithul jaggery custard with cashews.", P.pudding, { popularRank: 1 }),
        I("Chocolate biscuit pudding", 500, "Marie biscuits, chocolate and coffee.", undefined, {
          popularRank: 2,
        }),
        I("Glazed donuts, box of 4", 1200, "Mixed glazes.", P.donut),
      ],
    ],
  ],
  grocery: [
    [
      "Fruit and vegetables",
      [
        G("Bananas, ambul", 450, "1 kg", "From Embilipitiya.", { popularRank: 1 }),
        G("King coconut", 150, "each", "Cut open on request."),
        G("Red onions", 520, "1 kg", "Jaffna red onions."),
        G("Tomatoes", 340, "500 g", ""),
        G("Green chillies", 90, "100 g", ""),
        G("Carrots", 290, "500 g", "Nuwara Eliya."),
        G("Gotukola", 80, "bunch", "For sambol or kola kenda."),
        G("Limes", 220, "250 g", ""),
        G("Papaya", 380, "about 1.2 kg", "Ripe, ready to eat."),
        G("Avocado", 260, "each", "", { soldOut: true }),
      ],
    ],
    [
      "Rice, flour and lentils",
      [
        G("Red raw rice", 320, "1 kg", "Locally grown.", { popularRank: 2 }),
        G("Keeri samba", 390, "1 kg", "For biryani and lamprais."),
        G("Samba rice", 1450, "5 kg", ""),
        G("Red lentils", 290, "500 g", "Mysore parippu."),
        G("Kurakkan flour", 340, "500 g", "Finger millet, for roti and pittu."),
        G("Basmati rice", 980, "1 kg", "", { soldOut: true }),
      ],
    ],
    [
      "Dairy and eggs",
      [
        G("Eggs", 650, "pack of 10", "Free range.", { popularRank: 3 }),
        G("Fresh milk", 490, "1 l", ""),
        G("Buffalo curd", 750, "900 ml clay pot", "Have it with kithul treacle."),
        G("Set yoghurt", 380, "pack of 4", ""),
        G("Salted butter", 1050, "200 g", ""),
        G("Cheddar", 1250, "200 g", ""),
      ],
    ],
    [
      "Bakery",
      [
        G("Sandwich bread", 220, "450 g loaf", "Baked this morning."),
        G("Kimbula buns", 280, "pack of 4", ""),
        G("Butter cake", 650, "400 g", ""),
        G("Roast paan", 140, "each", "", { soldOut: true }),
      ],
    ],
    [
      "Spices and pantry",
      [
        G("Coconut milk", 380, "400 ml", "", { popularRank: 4 }),
        G("Roasted curry powder", 260, "100 g", ""),
        G("Chilli flakes", 240, "100 g", ""),
        G("Maldive fish", 690, "100 g", "For pol sambol."),
        G("Kithul treacle", 980, "375 ml", ""),
        G("Coconut oil", 850, "1 l", ""),
        G("White sugar", 300, "1 kg", ""),
        G("Ceylon black tea", 1150, "400 g", "BOPF, from Dimbula."),
      ],
    ],
    [
      "Snacks and drinks",
      [
        G("Marie biscuits", 280, "360 g", ""),
        G("Cream crackers", 450, "490 g", ""),
        G("Murukku", 350, "200 g", "Spicy."),
        G("Ginger beer", 420, "1.5 l", ""),
        G("Drinking water", 130, "1.5 l", ""),
      ],
    ],
    [
      "Household",
      [
        G("Dishwashing liquid", 420, "500 ml", ""),
        G("Laundry soap", 260, "pack of 2", ""),
        G("Toilet rolls", 650, "pack of 4", ""),
        G("Garbage bags", 320, "pack of 10", "Large."),
      ],
    ],
  ],
};

// ---------- Home collections (admin mock) ----------

export interface SeedCollection {
  n: number;
  title: string;
  subtitle: string;
  placement: "banner" | "shelf";
  source: "rules" | "handPicked";
  rule?: { categoryId?: string; minRating?: number; maxEtaMinutes?: number; offersOnly?: boolean };
  restaurants: number[];
  startsOn: string;
  endsOn?: string;
}

export const seedCollections: SeedCollection[] = [
  {
    n: 1,
    title: "Rainy evening comfort",
    subtitle: "Kottu, curry and something sweet",
    placement: "banner",
    source: "handPicked",
    restaurants: [1, 2, 12, 14],
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
  },
  {
    n: 2,
    title: "Here in 20 minutes",
    subtitle: "Kitchens close to you",
    placement: "shelf",
    source: "rules",
    rule: { maxEtaMinutes: 20 },
    restaurants: [],
    startsOn: "2026-09-01",
  },
  {
    n: 3,
    title: "Offers near you",
    subtitle: "Deals from restaurants in your area",
    placement: "shelf",
    source: "rules",
    rule: { offersOnly: true },
    restaurants: [],
    startsOn: "2026-09-01",
  },
  {
    n: 4,
    title: "Top rated rice and curry",
    subtitle: "4.7 stars and up",
    placement: "shelf",
    source: "rules",
    rule: { categoryId: "rice", minRating: 4.7 },
    restaurants: [],
    startsOn: "2026-09-15",
  },
  {
    n: 5,
    title: "Watalappan week",
    subtitle: "Rs 200 off two with WATALAPPAN2",
    placement: "banner",
    source: "handPicked",
    restaurants: [12, 4],
    startsOn: "2026-10-17",
    endsOn: "2026-10-31",
  },
];
