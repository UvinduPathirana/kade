import { useEffect } from "react";

/** Sets the tab title as "<page> | Kadé for restaurants". */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} | Kadé for restaurants` : "Kadé for restaurants";
  }, [title]);
}
