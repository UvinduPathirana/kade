import { Button, EmptyState } from "@kade/ui";
import c from "@/layout/common.module.css";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <div className={c.page}>
      <h1 className="kd-visually-hidden">Page not found</h1>
      <EmptyState
        title="This screen isn't in the rider app"
        description="The link may be old. Head back to the map to keep riding."
        action={<Button href="/">Back to the map</Button>}
      />
    </div>
  );
}
