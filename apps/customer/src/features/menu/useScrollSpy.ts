import { useEffect, useState } from "react";

/**
 * Returns the id of the first section (in document order) inside the "reading band" of the viewport.
 * The band starts below the sticky header + menu nav and ends just past the middle of the screen.
 */
export function useScrollSpy(ids: string[], topOffset = 140): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join(",");

  useEffect(() => {
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)));
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: `-${topOffset}px 0px -55% 0px` },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures `ids`
  }, [key, topOffset]);

  return active;
}
