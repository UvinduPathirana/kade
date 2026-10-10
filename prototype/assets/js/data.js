// Mock catalogue shared by every customer page. Shape mirrors what the API will return later.
window.Kade = window.Kade || {};

(() => {
  const img = (id, w = 640, h = 400) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=70`;
  const rs = (n) => `Rs ${Math.round(n).toLocaleString("en-LK")}`;

  const P = {
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
  };

  const categories = [
    { id: "all", label: "All", photo: P.spread },
    { id: "rice", label: "Rice & curry", photo: P.curry },
    { id: "kottu", label: "Kottu", photo: P.kottu },
    { id: "shorteats", label: "Short eats", photo: P.samosa },
    { id: "biryani", label: "Biryani", photo: P.biryani },
    { id: "seafood", label: "Seafood", photo: P.fishCurry },
    { id: "burgers", label: "Burgers", photo: P.burger },
    { id: "pizza", label: "Pizza", photo: P.pizza },
    { id: "asian", label: "Noodles & ramen", photo: P.ramen },
    { id: "sushi", label: "Sushi", photo: P.sushi },
    { id: "healthy", label: "Salads & bowls", photo: P.bowl },
    { id: "dessert", label: "Desserts", photo: P.donut },
    { id: "grocery", label: "Grocery", photo: P.grocery },
  ];

  // eta in minutes [min, max]; fee 0 = free delivery; price 1–3; discount = % off the subtotal
  const restaurants = [
    { id: 1, name: "Galle Road Kottu House", cat: "kottu", photo: P.kottu, eta: [15, 25], fee: 150, rating: 4.8, reviews: "3k+", price: 1, offer: "20% off kottu", discount: 20, veg: false, again: true, area: "Kollupitiya", km: 1.2, hours: "11 am – 2 am" },
    { id: 2, name: "Amma's Rice & Curry", cat: "rice", photo: P.curry, eta: [20, 30], fee: 0, rating: 4.9, reviews: "5k+", price: 1, veg: true, again: true, area: "Bambalapitiya", km: 1.8, hours: "10 am – 10 pm" },
    { id: 3, name: "Kompanna Short Eats", cat: "shorteats", photo: P.buns, eta: [10, 20], fee: 120, rating: 4.6, reviews: "1k+", price: 1, offer: "Buy 5, get 2 free", veg: false, again: true, area: "Slave Island", km: 0.9, hours: "7 am – 9 pm" },
    { id: 4, name: "Marine Drive Biryani", cat: "biryani", photo: P.biryani, eta: [25, 35], fee: 200, rating: 4.7, reviews: "2k+", price: 2, offer: "Rs 300 off Rs 2,500+", veg: false, area: "Wellawatte", km: 3.1, hours: "11 am – 11 pm" },
    { id: 5, name: "Negombo Fish Curry Co.", cat: "seafood", photo: P.fishCurry, eta: [30, 40], fee: 250, rating: 4.5, reviews: "800+", price: 2, veg: false, area: "Dehiwala", km: 4.4, hours: "11 am – 10 pm" },
    { id: 6, name: "Smash Shed", cat: "burgers", photo: P.burger, eta: [20, 30], fee: 0, rating: 4.4, reviews: "2k+", price: 2, offer: "Free fries over Rs 2,000", veg: false, again: true, area: "Kollupitiya", km: 1.4, hours: "12 pm – 1 am" },
    { id: 7, name: "Wood & Fire Pizza", cat: "pizza", photo: P.pizza, eta: [30, 45], fee: 180, rating: 4.6, reviews: "1k+", price: 3, veg: true, area: "Cinnamon Gardens", km: 2.6, hours: "12 pm – 11 pm" },
    { id: 8, name: "Noodle Lane", cat: "asian", photo: P.ramen, eta: [25, 35], fee: 150, rating: 4.7, reviews: "900+", price: 2, offer: "15% off ramen", discount: 15, veg: false, area: "Bambalapitiya", km: 2.0, hours: "11 am – 11 pm" },
    { id: 9, name: "Sakura Colombo", cat: "sushi", photo: P.sushi, eta: [35, 50], fee: 300, rating: 4.8, reviews: "600+", price: 3, veg: false, area: "Colombo 07", km: 3.5, hours: "12 pm – 10 pm" },
    { id: 10, name: "Green Cabin Bowls", cat: "healthy", photo: P.salad, eta: [15, 25], fee: 0, rating: 4.5, reviews: "700+", price: 2, veg: true, area: "Kollupitiya", km: 1.1, hours: "8 am – 9 pm" },
    { id: 11, name: "Pettah Isso Wade", cat: "shorteats", photo: P.chaat, eta: [20, 30], fee: 100, rating: 4.6, reviews: "1k+", price: 1, veg: false, area: "Galle Face", km: 1.6, hours: "3 pm – 11 pm" },
    { id: 12, name: "Watalappan Bar", cat: "dessert", photo: P.pudding, eta: [15, 25], fee: 120, rating: 4.9, reviews: "1k+", price: 1, offer: "2 for Rs 900", veg: true, area: "Colombo 03", km: 1.0, hours: "10 am – 11 pm" },
    { id: 13, name: "Ceylon Fried Chicken", cat: "burgers", photo: P.chicken, eta: [20, 30], fee: 150, rating: 4.3, reviews: "2k+", price: 1, veg: false, area: "Bambalapitiya", km: 2.2, hours: "11 am – 12 am" },
    { id: 14, name: "Jaffna Curry Pot", cat: "rice", photo: P.curry2, eta: [30, 40], fee: 200, rating: 4.7, reviews: "1k+", price: 1, veg: false, area: "Wellawatte", km: 3.3, hours: "11 am – 10 pm" },
    { id: 15, name: "Kadé Market", cat: "grocery", photo: P.grocery, eta: [20, 35], fee: 0, rating: 4.6, reviews: "4k+", price: 1, offer: "Rs 500 off first shop", veg: true, area: "Colombo 03", km: 0.8, hours: "6 am – 12 am" },
    { id: 16, name: "Donut Republic", cat: "dessert", photo: P.donut, eta: [15, 25], fee: 150, rating: 4.4, reviews: "500+", price: 1, veg: true, closed: "Opens at 8 am", area: "Colombo 04", km: 2.4, hours: "8 am – 8 pm" },
  ];

  // Option groups referenced by menu items. required + max 1 = pick exactly one.
  const optionGroups = {
    spice: { name: "Spice level", required: true, max: 1, choices: [["Mild", 0], ["Medium", 0], ["Sri Lankan hot", 0]] },
    kottuExtras: { name: "Extras", required: false, max: 4, choices: [["Extra egg", 150], ["Extra cheese", 250], ["Extra chicken", 350], ["Curry gravy on the side", 0]] },
    portion: { name: "Portion", required: true, max: 1, choices: [["Regular", 0], ["Large", 400]] },
    pizzaSize: { name: "Size", required: true, max: 1, choices: [["Medium, 10 inch", 0], ["Large, 14 inch", 900]] },
    burgerExtras: { name: "Add to your burger", required: false, max: 3, choices: [["Cheese slice", 200], ["Fried egg", 150], ["Bacon", 350]] },
    sugar: { name: "Sweetness", required: true, max: 1, choices: [["Normal", 0], ["Less sugar", 0], ["No sugar", 0]] },
    sides: { name: "Add a side", required: false, max: 2, choices: [["Papadam", 80], ["Seeni sambol", 120], ["Pol sambol", 100]] },
  };

  // [name, price, description, photo, { tags, options, popular, soldOut }]
  const I = (name, price, desc, photo, extra = {}) => ({ name, price, desc, photo, ...extra });

  const menuTemplates = {
    kottu: [
      ["Kottu", [
        I("Chicken kottu", 1150, "Chopped godamba roti on the griddle with chicken curry, egg, leeks and carrot.", P.kottu, { popular: 1, options: ["spice", "kottuExtras"], tags: ["Spicy"] }),
        I("Cheese kottu", 1450, "Chicken kottu folded through with melted cheese. The house favourite.", P.kottu, { popular: 2, options: ["spice", "kottuExtras"] }),
        I("Dolphin kottu", 1650, "Whole roti in soft strips, chicken curry gravy poured over at the table.", null, { options: ["spice", "kottuExtras"] }),
        I("Egg kottu", 950, "Roti, egg, cabbage and leeks with a little curry gravy.", null, { options: ["spice", "kottuExtras"] }),
        I("Vegetable kottu", 850, "Roti with carrot, leeks, cabbage and dhal curry.", null, { options: ["spice", "kottuExtras"], tags: ["Vegetarian"] }),
        I("Beef kottu", 1350, "Slow-cooked beef curry chopped through roti.", null, { options: ["spice", "kottuExtras"], tags: ["Spicy"] }),
        I("String hopper kottu", 1250, "String hoppers chopped with chicken, egg and onion.", null, { options: ["spice"], soldOut: true }),
      ]],
      ["Rice and noodles", [
        I("Chicken fried rice", 1100, "Basmati fried with egg, vegetables and chilli paste on the side.", P.friedRice, { options: ["portion"] }),
        I("Nasi goreng", 1350, "Sweet-spicy fried rice with a fried egg and chicken satay.", P.tomatoDish, { options: ["portion"] }),
        I("Seafood noodles", 1500, "Egg noodles with prawns, cuttlefish and spring onion.", P.noodleSoup, { options: ["spice"] }),
      ]],
      ["Devilled", [
        I("Devilled chicken", 1400, "Crispy chicken tossed with onion, capsicum and chilli sauce.", P.chicken, { popular: 3, options: ["spice"], tags: ["Spicy"] }),
        I("Hot butter cuttlefish", 1650, "Battered cuttlefish fried with butter, garlic and dried chilli.", P.sizzler, { options: ["spice"] }),
        I("Devilled prawns", 1900, "Tiger prawns in a sticky tomato and chilli sauce.", P.gravy, { options: ["spice"], tags: ["Spicy"] }),
      ]],
      ["Short eats", [
        I("Fish roll", 180, "Crumbed pancake roll filled with spiced fish and potato.", P.samosa),
        I("Chicken patty", 160, "Flaky pastry half-moon with curried chicken.", P.buns),
        I("Egg roti", 220, "Thin roti folded around an egg, with lunu miris.", null),
      ]],
      ["Drinks and dessert", [
        I("Faluda", 450, "Rose syrup, milk, basil seeds and a scoop of ice cream.", P.pudding, { popular: 4, options: ["sugar"] }),
        I("Iced Milo", 400, "Made strong, the way the kades do it.", null, { options: ["sugar"] }),
        I("Woodapple juice", 380, "Fresh woodapple blended with jaggery.", null, { options: ["sugar"], tags: ["Vegetarian"] }),
        I("Watalappan", 350, "Kithul jaggery and coconut custard with cashews.", null, { tags: ["Vegetarian"] }),
      ]],
    ],
    rice: [
      ["Rice and curry", [
        I("Chicken rice and curry", 750, "Red rice, chicken curry, dhal, beans, mallung and papadam.", P.curry, { popular: 1, options: ["portion", "sides"] }),
        I("Fish rice and curry", 800, "Red rice, ambul thiyal, dhal, brinjal moju and greens.", P.fishCurry, { popular: 2, options: ["portion", "sides"] }),
        I("Vegetable rice and curry", 600, "Red rice with five vegetable curries and pol sambol.", P.curry2, { options: ["portion", "sides"], tags: ["Vegetarian"] }),
      ]],
      ["Curries on their own", [
        I("Black pork curry", 1100, "Roasted spices and goraka, cooked down until dark.", P.curry3, { popular: 3, tags: ["Spicy"] }),
        I("Jackfruit curry", 550, "Young polos curry in coconut milk.", null, { tags: ["Vegetarian"] }),
        I("Parippu", 300, "Red lentils tempered with mustard seed and curry leaves.", null, { tags: ["Vegetarian"] }),
      ]],
    ],
    shorteats: [
      ["Short eats", [
        I("Fish bun", 140, "Soft triangle bun with spiced fish and potato.", P.buns, { popular: 1 }),
        I("Vegetable roti", 120, "Triangle roti with curried potato and leeks.", null, { popular: 2, tags: ["Vegetarian"] }),
        I("Chicken patty", 160, "Flaky pastry half-moon with curried chicken.", P.samosa, { popular: 3 }),
        I("Isso wade", 250, "Lentil fritter topped with whole prawns.", P.chaat),
      ]],
      ["Sweet", [
        I("Kimbula bun", 120, "Crocodile-shaped sugar bun.", null, { tags: ["Vegetarian"] }),
        I("Love cake slice", 300, "Semolina, cashew and pumpkin preserve.", null, { tags: ["Vegetarian"] }),
      ]],
    ],
    biryani: [
      ["Biryani", [
        I("Chicken biryani", 1450, "Dum-cooked basmati, chicken leg, boiled egg, raita and mint sambol.", P.biryani, { popular: 1, options: ["portion"] }),
        I("Mutton biryani", 1900, "Bone-in mutton, fried onions, cashews and sultanas.", P.biryani, { popular: 2, options: ["portion"] }),
        I("Vegetable biryani", 1100, "Paneer, peas and carrot with saffron rice.", null, { options: ["portion"], tags: ["Vegetarian"] }),
      ]],
      ["Sides", [
        I("Wattalappam", 350, "Jaggery coconut custard.", P.pudding),
        I("Mint sambol", 150, "Fresh mint, coconut and green chilli.", null, { tags: ["Vegetarian"] }),
      ]],
    ],
    seafood: [
      ["From the lagoon", [
        I("Ambul thiyal with rice", 1600, "Sour tuna curry with goraka, served with red rice.", P.fishCurry, { popular: 1, options: ["spice"] }),
        I("Crab curry", 3200, "Lagoon crab in a Jaffna-style curry.", P.curry3, { popular: 2, options: ["spice"], tags: ["Spicy"] }),
        I("Prawn curry", 2100, "Tiger prawns in coconut milk and chilli.", P.gravy, { options: ["spice"] }),
      ]],
      ["Grilled", [
        I("Grilled seer fish", 2400, "With garlic butter, salad and chips.", P.grill),
        I("Cuttlefish skewers", 1500, "Three skewers with lime and chilli salt.", P.sizzler),
      ]],
    ],
    burgers: [
      ["Burgers", [
        I("Double smash", 1850, "Two beef patties, cheese, pickles and house sauce.", P.burger, { popular: 1, options: ["burgerExtras"] }),
        I("Spicy chicken burger", 1550, "Fried thigh, lunu miris mayo and slaw.", P.chicken, { popular: 2, options: ["burgerExtras"], tags: ["Spicy"] }),
        I("Mushroom burger", 1450, "Portobello, cheese and caramelised onion.", null, { options: ["burgerExtras"], tags: ["Vegetarian"] }),
      ]],
      ["Sides", [
        I("Fries", 550, "Skin-on, salted.", null, { popular: 3, tags: ["Vegetarian"] }),
        I("Chicken wings", 1200, "Six wings, devilled or honey chilli.", P.chicken, { options: ["spice"] }),
      ]],
    ],
    pizza: [
      ["Pizza", [
        I("Margherita", 2200, "Tomato, mozzarella and basil.", P.pizza2, { popular: 1, options: ["pizzaSize"], tags: ["Vegetarian"] }),
        I("Devilled chicken pizza", 2800, "Devilled chicken, onion, capsicum and green chilli.", P.pizza, { popular: 2, options: ["pizzaSize"], tags: ["Spicy"] }),
        I("Four cheese", 2900, "Mozzarella, cheddar, parmesan and blue.", null, { options: ["pizzaSize"], tags: ["Vegetarian"] }),
      ]],
      ["Salads", [I("Garden salad", 1100, "Leaves, cucumber, tomato and vinaigrette.", P.salad2, { tags: ["Vegetarian"] })]],
    ],
    asian: [
      ["Ramen and noodles", [
        I("Chicken shoyu ramen", 1900, "Soy broth, chashu chicken, egg and nori.", P.ramen, { popular: 1, options: ["spice"] }),
        I("Laksa", 1800, "Coconut curry broth, prawns and rice noodles.", P.laksa, { popular: 2, options: ["spice"], tags: ["Spicy"] }),
        I("Dan dan noodles", 1500, "Sesame, chilli oil and minced chicken.", P.noodleSoup, { options: ["spice"] }),
      ]],
      ["Small plates", [I("Gyoza", 950, "Six pan-fried chicken dumplings.", null), I("Edamame", 650, "Sea salt.", null, { tags: ["Vegetarian"] })]],
    ],
    sushi: [
      ["Rolls", [
        I("Salmon avocado roll", 2400, "Eight pieces.", P.sushi, { popular: 1 }),
        I("Prawn tempura roll", 2200, "Eight pieces with spicy mayo.", P.sushi, { popular: 2 }),
        I("Cucumber roll", 1200, "Six pieces.", null, { tags: ["Vegetarian"] }),
      ]],
      ["Bowls", [I("Poke bowl", 2600, "Tuna, rice, edamame and sesame.", P.bowl)]],
    ],
    healthy: [
      ["Bowls", [
        I("Chicken grain bowl", 1650, "Red rice, grilled chicken, gotukola and tahini.", P.bowl, { popular: 1 }),
        I("Falafel bowl", 1450, "Falafel, hummus, pickles and greens.", P.salad, { popular: 2, tags: ["Vegetarian"] }),
        I("Gotukola sambol salad", 950, "Pennywort, coconut, lime and red onion.", P.salad2, { tags: ["Vegetarian"] }),
      ]],
      ["Soups", [I("Kola kenda", 450, "Herbal porridge with jaggery on the side.", P.soup, { tags: ["Vegetarian"] })]],
    ],
    dessert: [
      ["Desserts", [
        I("Watalappan jar", 450, "Kithul jaggery custard with cashews.", P.pudding, { popular: 1 }),
        I("Chocolate biscuit pudding", 500, "Marie biscuits, chocolate and coffee.", null, { popular: 2 }),
        I("Glazed donuts, box of 4", 1200, "Mixed glazes.", P.donut),
      ]],
    ],
    grocery: [
      ["Everyday", [
        I("Red rice, 1 kg", 320, "Locally grown.", P.grocery, { popular: 1 }),
        I("Coconut milk, 400 ml", 380, "", null, { popular: 2 }),
        I("Eggs, pack of 10", 650, "Free range.", null),
        I("Bananas, 1 kg", 450, "Ambul kesel.", null),
      ]],
    ],
  };

  const reviews = [
    { name: "Shehani", when: "2 days ago", dish: "Cheese kottu", stars: 5, text: "Arrived hot and the cheese was still stretchy. Medium spice is properly spicy." },
    { name: "Ravindu", when: "Last week", dish: "Devilled chicken", stars: 5, text: "Big portion, crispy even after the ride. Ordering again on Friday." },
    { name: "Aisha", when: "2 weeks ago", dish: "Dolphin kottu", stars: 4, text: "Gravy came on the side so it didn't go soggy. Rider called when he reached the gate." },
  ];

  function menuFor(restaurant) {
    const sections = (menuTemplates[restaurant.cat] || menuTemplates.rice).map(([name, items], s) => ({
      id: `s${s}`,
      name,
      items: items.map((it, i) => ({ ...it, id: `${restaurant.id}-${s}-${i}`, options: it.options || [], tags: it.tags || [] })),
    }));
    const popular = sections.flatMap((s) => s.items).filter((it) => it.popular).sort((a, b) => a.popular - b.popular);
    return { sections, popular };
  }

  Object.assign(window.Kade, { img, rs, photos: P, categories, restaurants, optionGroups, menuFor, reviews,
    restaurant: (id) => restaurants.find((r) => r.id === Number(id)) });
})();
