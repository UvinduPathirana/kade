import { useEffect } from "react";

/** Sets the tab title as "<page> | Kadé". */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} | Kadé` : "Kadé: food delivery in Colombo";
  }, [title]);
}
