import { Button, EmptyState } from "@kade/ui";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <>
      <h1 className="kd-visually-hidden">Page not found</h1>
      <EmptyState
        title="There's no page at this address"
        description="Check the link, or go back to the live dashboard."
        action={<Button href="/">Go to live dashboard</Button>}
      />
    </>
  );
}
