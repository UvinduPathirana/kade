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
