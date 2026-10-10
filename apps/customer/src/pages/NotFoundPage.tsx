import { Button, Container } from "@kade/ui";
import { SiteHeader } from "@/layout/SiteHeader";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./NotFoundPage.module.css";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <>
      <SiteHeader />
      <Container className={styles.page}>
        <h1>This page isn't on Kadé</h1>
        <p>The link may be old or mistyped. Head back to find something to eat.</p>
        <Button href="/">See restaurants near you</Button>
      </Container>
    </>
  );
}

/** Routes that are planned but not designed yet (see PAGES.md). */
export function NotBuiltYetPage() {
  useDocumentTitle("Coming soon");
  return (
    <>
      <SiteHeader />
      <Container className={styles.page}>
        <h1>This page is still being built</h1>
        <p>It's on the plan for the next phase. Your cart is saved, so nothing is lost.</p>
        <Button href="/">Back to restaurants</Button>
      </Container>
    </>
  );
}
