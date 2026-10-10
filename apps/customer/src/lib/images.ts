/** Placeholder photos are Unsplash ids; restaurants' own uploads will replace them. */
export function imageUrl(id: string, width = 640, height = 400): string {
  return `https://images.unsplash.com/photo-${id}?w=${width}&h=${height}&fit=crop&q=70`;
}

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
