/** Placeholder photos are Unsplash ids (the same ones the customer app shows); uploads replace them. */
export function imageUrl(id: string, width = 320, height = 240): string {
  if (id.startsWith("data:") || id.startsWith("blob:")) return id;
  return `https://images.unsplash.com/photo-${id}?w=${width}&h=${height}&fit=crop&q=70`;
}

export const photos = {
  kottu: "1589302168068-964664d93dc0",
  friedRice: "1603133872878-684f208fb84b",
  tomatoDish: "1645177628172-a94c1f96e6db",
  noodleSoup: "1559847844-5315695dadae",
  chicken: "1626074353765-517a681e40be",
  sizzler: "1567188040759-fb8a883dc6d8",
  gravy: "1565557623262-b51c2513a641",
  samosa: "1601050690597-df0568f70950",
  buns: "1606491956689-2ea866880c84",
  pudding: "1488477181946-6428a0291777",
} as const;

/**
 * Shrinks an uploaded photo to at most 800px wide and returns it as a JPEG data URL, so the mock
 * menu service can keep it in localStorage. The real menu service takes the file as an upload.
 */
export function resizePhoto(file: File, maxWidth = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file isn't a photo we can read. Try a JPG or PNG."));
    };
    img.src = url;
  });
}
