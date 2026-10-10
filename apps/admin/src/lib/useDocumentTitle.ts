import { useEffect } from "react";

/** Sets the tab title as "<page> | Kadé Ops". */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | Kadé Ops`;
  }, [title]);
}
