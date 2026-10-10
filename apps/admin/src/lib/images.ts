/** Placeholder photos are Unsplash ids, the same ones the customer app uses. */
export function imageUrl(id: string, width = 160, height = 120): string {
  return `https://images.unsplash.com/photo-${id}?w=${width}&h=${height}&fit=crop&q=60`;
}
