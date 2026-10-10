import { Button, EmptyState } from "@kade/ui";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <>
      <h1 className="kd-visually-hidden">Page not found</h1>
      <EmptyState
        title="This page isn't in the partner app"
        description="The link may be old or mistyped."
        action={<Button href="/">Back to live orders</Button>}
      />
    </>
  );
}
