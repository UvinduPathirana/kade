// Mock catalogue data. Only api/catalog.ts reads this; pages go through the API functions.
import { photos as P } from "@/lib/images";
import type { Category, Menu, MenuItem, OptionGroup, Restaurant, Review } from "../types";

export const categories: Category[] = [
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

type R = Omit<Restaurant, "priceLevel"> & { priceLevel: number };
const restaurantRows: R[] = [
  {
    id: 1,
    name: "Galle Road Kottu House",
    categoryId: "kottu",
    imageId: P.kottu,
    eta: [15, 25],
    deliveryFee: 150,
    rating: 4.8,
    ratingCount: "3k+",
    priceLevel: 1,
    offer: "20% off kottu",
    discountPercent: 20,
    hasVegetarian: false,
    orderedBefore: true,
    area: "Kollupitiya",
    distanceKm: 1.2,
    hours: "11 am – 2 am",
  },
  {
    id: 2,
    name: "Amma's Rice & Curry",
    categoryId: "rice",
    imageId: P.curry,
    eta: [20, 30],
    deliveryFee: 0,
    rating: 4.9,
    ratingCount: "5k+",
    priceLevel: 1,
    hasVegetarian: true,
    orderedBefore: true,
    area: "Bambalapitiya",
    distanceKm: 1.8,
    hours: "10 am – 10 pm",
  },
  {
    id: 3,
    name: "Kompanna Short Eats",
    categoryId: "shorteats",
    imageId: P.buns,
    eta: [10, 20],
    deliveryFee: 120,
    rating: 4.6,
    ratingCount: "1k+",
    priceLevel: 1,
    offer: "Buy 5, get 2 free",
    hasVegetarian: false,
    orderedBefore: true,
    area: "Slave Island",
    distanceKm: 0.9,
    hours: "7 am – 9 pm",
  },
  {
    id: 4,
    name: "Marine Drive Biryani",
    categoryId: "biryani",
    imageId: P.biryani,
    eta: [25, 35],
    deliveryFee: 200,
    rating: 4.7,
    ratingCount: "2k+",
    priceLevel: 2,
    offer: "Rs 300 off Rs 2,500+",
    hasVegetarian: false,
    area: "Wellawatte",
    distanceKm: 3.1,
    hours: "11 am – 11 pm",
  },
  {
    id: 5,
    name: "Negombo Fish Curry Co.",
    categoryId: "seafood",
    imageId: P.fishCurry,
    eta: [30, 40],
    deliveryFee: 250,
    rating: 4.5,
    ratingCount: "800+",
    priceLevel: 2,
    hasVegetarian: false,
    area: "Dehiwala",
    distanceKm: 4.4,
    hours: "11 am – 10 pm",
  },
  {
    id: 6,
    name: "Smash Shed",
    categoryId: "burgers",
    imageId: P.burger,
    eta: [20, 30],
    deliveryFee: 0,
    rating: 4.4,
    ratingCount: "2k+",
    priceLevel: 2,
    offer: "Free fries over Rs 2,000",
    hasVegetarian: false,
    orderedBefore: true,
    area: "Kollupitiya",
    distanceKm: 1.4,
    hours: "12 pm – 1 am",
  },
  {
    id: 7,
    name: "Wood & Fire Pizza",
    categoryId: "pizza",
    imageId: P.pizza,
    eta: [30, 45],
    deliveryFee: 180,
    rating: 4.6,
    ratingCount: "1k+",
    priceLevel: 3,
    hasVegetarian: true,
    area: "Cinnamon Gardens",
    distanceKm: 2.6,
    hours: "12 pm – 11 pm",
  },
  {
    id: 8,
    name: "Noodle Lane",
    categoryId: "asian",
    imageId: P.ramen,
    eta: [25, 35],
    deliveryFee: 150,
    rating: 4.7,
    ratingCount: "900+",
    priceLevel: 2,
    offer: "15% off ramen",
    discountPercent: 15,
    hasVegetarian: false,
    area: "Bambalapitiya",
    distanceKm: 2.0,
    hours: "11 am – 11 pm",
  },
  {
    id: 9,
    name: "Sakura Colombo",
    categoryId: "sushi",
    imageId: P.sushi,
    eta: [35, 50],
    deliveryFee: 300,
    rating: 4.8,
    ratingCount: "600+",
    priceLevel: 3,
    hasVegetarian: false,
    area: "Colombo 07",
    distanceKm: 3.5,
    hours: "12 pm – 10 pm",
  },
  {
    id: 10,
    name: "Green Cabin Bowls",
    categoryId: "healthy",
    imageId: P.salad,
    eta: [15, 25],
    deliveryFee: 0,
    rating: 4.5,
    ratingCount: "700+",
    priceLevel: 2,
    hasVegetarian: true,
    area: "Kollupitiya",
    distanceKm: 1.1,
    hours: "8 am – 9 pm",
  },
  {
    id: 11,
    name: "Pettah Isso Wade",
    categoryId: "shorteats",
    imageId: P.chaat,
    eta: [20, 30],
    deliveryFee: 100,
    rating: 4.6,
    ratingCount: "1k+",
    priceLevel: 1,
    hasVegetarian: false,
    area: "Galle Face",
    distanceKm: 1.6,
    hours: "3 pm – 11 pm",
  },
  {
    id: 12,
    name: "Watalappan Bar",
    categoryId: "dessert",
    imageId: P.pudding,
    eta: [15, 25],
    deliveryFee: 120,
    rating: 4.9,
    ratingCount: "1k+",
    priceLevel: 1,
    offer: "2 for Rs 900",
    hasVegetarian: true,
    area: "Colombo 03",
    distanceKm: 1.0,
    hours: "10 am – 11 pm",
  },
  {
    id: 13,
    name: "Ceylon Fried Chicken",
    categoryId: "burgers",
    imageId: P.chicken,
    eta: [20, 30],
    deliveryFee: 150,
    rating: 4.3,
    ratingCount: "2k+",
    priceLevel: 1,
    hasVegetarian: false,
    area: "Bambalapitiya",
    distanceKm: 2.2,
    hours: "11 am – 12 am",
  },
  {
    id: 14,
    name: "Jaffna Curry Pot",
    categoryId: "rice",
    imageId: P.curry2,
    eta: [30, 40],
    deliveryFee: 200,
    rating: 4.7,
    ratingCount: "1k+",
    priceLevel: 1,
    hasVegetarian: false,
    area: "Wellawatte",
    distanceKm: 3.3,
    hours: "11 am – 10 pm",
  },
  {
    id: 15,
    name: "Kadé Market",
    categoryId: "grocery",
    imageId: P.grocery,
    eta: [20, 35],
    deliveryFee: 0,
    rating: 4.6,
    ratingCount: "4k+",
    priceLevel: 1,
    offer: "Rs 500 off first shop",
    hasVegetarian: true,
    area: "Colombo 03",
    distanceKm: 0.8,
    hours: "6 am – 12 am",
  },
  {
    id: 16,
    name: "Donut Republic",
    categoryId: "dessert",
    imageId: P.donut,
    eta: [15, 25],
    deliveryFee: 150,
    rating: 4.4,
    ratingCount: "500+",
    priceLevel: 1,
    hasVegetarian: true,
    closedLabel: "Opens at 8 am",
    area: "Colombo 04",
    distanceKm: 2.4,
    hours: "8 am – 8 pm",
  },
];
export const restaurants = restaurantRows as Restaurant[];

export const optionGroups: Record<string, OptionGroup> = Object.fromEntries(
  (
    [
      [
        "spice",
        "Spice level",
        true,
        1,
        [
          ["Mild", 0],
          ["Medium", 0],
          ["Sri Lankan hot", 0],
        ],
      ],
      [
        "kottuExtras",
        "Extras",
        false,
        4,
        [
          ["Extra egg", 150],
          ["Extra cheese", 250],
          ["Extra chicken", 350],
          ["Curry gravy on the side", 0],
        ],
      ],
      [
        "portion",
        "Portion",
        true,
        1,
        [
          ["Regular", 0],
          ["Large", 400],
        ],
      ],
      [
        "pizzaSize",
        "Size",
        true,
        1,
        [
          ["Medium, 10 inch", 0],
          ["Large, 14 inch", 900],
        ],
      ],
      [
        "burgerExtras",
        "Add to your burger",
        false,
        3,
        [
          ["Cheese slice", 200],
          ["Fried egg", 150],
          ["Bacon", 350],
        ],
      ],
      [
        "sugar",
        "Sweetness",
        true,
        1,
        [
          ["Normal", 0],
          ["Less sugar", 0],
          ["No sugar", 0],
        ],
      ],
      [
        "sides",
        "Add a side",
        false,
        2,
        [
          ["Papadam", 80],
          ["Seeni sambol", 120],
          ["Pol sambol", 100],
        ],
      ],
    ] as const
  ).map(([id, name, required, max, choices]) => [
    id,
    { id, name, required, max, choices: choices.map(([n, price]) => ({ name: n, price })) },
  ]),
);

type ItemSeed = Omit<MenuItem, "id" | "tags" | "optionGroupIds"> & {
  tags?: MenuItem["tags"];
  options?: string[];
};
const I = (
  name: string,
  price: number,
  description: string,
  imageId?: string,
  extra: Partial<ItemSeed> = {},
): ItemSeed => ({
  name,
  price,
  description,
  imageId,
  ...extra,
});

/** A shop product: priced per pack or weight, no options. */
const G = (name: string, price: number, unit: string, description: string, extra: Partial<ItemSeed> = {}) =>
  I(name, price, description, undefined, { unit, ...extra });

const menuTemplates: Record<string, Array<[string, ItemSeed[]]>> = {
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
          { popularRank: 2, options: ["spice", "kottuExtras"] },
        ),
        I(
          "Dolphin kottu",
          1650,
          "Whole roti in soft strips, chicken curry gravy poured over at the table.",
          undefined,
          { options: ["spice", "kottuExtras"] },
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
          { options: ["portion"] },
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
          { popularRank: 3, options: ["spice"], tags: ["Spicy"] },
        ),
        I(
          "Hot butter cuttlefish",
          1650,
          "Battered cuttlefish fried with butter, garlic and dried chilli.",
          P.sizzler,
          { options: ["spice"] },
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
          { popularRank: 1, options: ["portion", "sides"] },
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
          { popularRank: 1, options: ["portion"] },
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
  // Kadé Market: aisles instead of menu sections, products sold by weight or pack
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

export function buildMenu(restaurant: Restaurant): Menu {
  const template = menuTemplates[restaurant.categoryId] ?? menuTemplates.rice!;
  const sections = template.map(([name, seeds], s) => ({
    id: `s${s}`,
    name,
    items: seeds.map(({ options, tags, ...seed }, i): MenuItem => ({
      ...seed,
      id: `${restaurant.id}-${s}-${i}`,
      tags: tags ?? [],
      optionGroupIds: options ?? [],
    })),
  }));
  const popular = sections
    .flatMap((s) => s.items)
    .filter((it) => it.popularRank)
    .sort((a, b) => a.popularRank! - b.popularRank!);
  const used = new Set(sections.flatMap((s) => s.items.flatMap((it) => it.optionGroupIds)));
  return {
    restaurantId: restaurant.id,
    sections,
    popular,
    optionGroups: Object.fromEntries(Object.entries(optionGroups).filter(([id]) => used.has(id))),
  };
}

export const reviews: Review[] = [
  {
    id: "rv1",
    name: "Shehani",
    when: "2 days ago",
    dish: "Cheese kottu",
    stars: 5,
    text: "Arrived hot and the cheese was still stretchy. Medium spice is properly spicy.",
  },
  {
    id: "rv2",
    name: "Ravindu",
    when: "Last week",
    dish: "Devilled chicken",
    stars: 5,
    text: "Big portion, crispy even after the ride. Ordering again on Friday.",
  },
  {
    id: "rv3",
    name: "Aisha",
    when: "2 weeks ago",
    dish: "Dolphin kottu",
    stars: 4,
    text: "Gravy came on the side so it didn't go soggy. Rider called when he reached the gate.",
  },
];

/** What people search for most this week. */
export const popularSearches = [
  "Kottu",
  "Biryani",
  "Fish buns",
  "Watalappan",
  "Ramen",
  "Rice and curry",
  "Eggs",
];
