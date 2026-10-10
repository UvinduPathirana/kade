import { Button, Chip, Container, EmptyState, SectionHeader, useToast } from "@kade/ui";
import { useMemo } from "react";
import { usePromos, useRestaurants } from "@/api/queries";
import { CollectionBand } from "@/features/collection/CollectionBand";
import { RestaurantGrid } from "@/features/feed/RestaurantGrid";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./CollectionPage.module.css";

export function OffersPage() {
  useDocumentTitle("Offers near you");
  const toast = useToast();
  const { data: restaurants = [], isError, refetch } = useRestaurants();
  const { data: promos = [] } = usePromos();
  // Open places first; closed ones still show so people can plan for later
  const offers = useMemo(
    () =>
      restaurants.filter((r) => r.offer).sort((a, b) => Number(!!a.closedLabel) - Number(!!b.closedLabel)),
    [restaurants],
  );

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast({ title: `${code} copied`, description: "Paste it in the promo code box at checkout." });
    } catch {
      toast({ title: `Use ${code} at checkout`, description: "Type it in the promo code box." });
    }
  };

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container>
          <CollectionBand
            title="Offers near you"
            description="Discounts end at 11 pm tonight. Restaurant offers come off at checkout on their own; codes go in the promo box."
          />

          <section className={styles.section} aria-labelledby="codes-title">
            <SectionHeader id="codes-title" title="Codes you can use" />
            <ul className={styles.codes}>
              {promos.map((p) => (
                <li key={p.code} className={styles.code}>
                  <div>
                    <strong>{p.code}</strong>
                    <span className={styles.codeLabel}>{p.label}</span>
                    <span>. {p.detail}.</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void copy(p.code)}
                    aria-label={`Copy ${p.code}`}
                  >
                    Copy
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="offers-title">
            <SectionHeader id="offers-title" title="Restaurants and shops with offers" />
            {isError ? (
              <EmptyState
                title="Offers didn't load"
                description="Check your connection, then try again."
                action={<Chip onClick={() => void refetch()}>Try again</Chip>}
              />
            ) : offers.length ? (
              <RestaurantGrid restaurants={offers} />
            ) : (
              <EmptyState
                title="No offers running right now"
                description="New offers usually start at lunchtime. Kadé Plus members get free delivery on orders over Rs 1,500 every day."
                action={<Button href="/plus">See Kadé Plus</Button>}
              />
            )}
          </section>
        </Container>
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
