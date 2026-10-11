/**
 * Lowercase, accents stripped ("Kadé" → "kade"), whitespace collapsed (as the customer app does),
 * and apostrophes dropped so "Amma's" indexes and matches as "ammas".
 */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Query words safe to put in a tsquery: letters and digits only ("Amma's" → "ammas"). */
export function queryWords(query: string): string[] {
  return normalise(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Every word as a prefix ("kott" finds "kottu"), all required. The same string is parsed with the
 * 'simple' config (exact prefixes) and the 'english' config (stems: "buns" → "bun").
 */
export function prefixQuery(words: string[]): string {
  return words.map((w) => `${w}:*`).join(" & ");
}

/** Category labels for restaurant matching ("rice" restaurants match "curry"). */
export const CATEGORY_LABELS: Record<string, string> = {
  rice: "Rice & curry",
  kottu: "Kottu",
  shorteats: "Short eats",
  biryani: "Biryani",
  seafood: "Seafood",
  burgers: "Burgers",
  pizza: "Pizza",
  asian: "Noodles & ramen",
  sushi: "Sushi",
  healthy: "Salads & bowls",
  dessert: "Desserts",
  grocery: "Grocery",
};

/** What a restaurant is found by: name, cuisine, category label and area (as the app's mock does). */
export function restaurantSearchText(r: {
  name: string;
  cuisine: string;
  categoryId: string;
  area: string;
}): string {
  return normalise([r.name, r.cuisine, CATEGORY_LABELS[r.categoryId] ?? r.categoryId, r.area].join(" "));
}
