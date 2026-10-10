import { useEffect } from "react";

/** Sets the tab title as "<page> | Kadé Rider". */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} | Kadé Rider` : "Kadé Rider";
  }, [title]);
}
