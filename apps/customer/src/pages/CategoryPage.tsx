import { Button, Chip, Container, EmptyState, SectionHeader, plural } from "@kade/ui";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { NotFoundError } from "@/api/catalog";
import { useCategories, useCategory, useRestaurants } from "@/api/queries";
import { useAddress } from "@/features/address/store";
import { useCart } from "@/features/cart/store";
import { CollectionBand } from "@/features/collection/CollectionBand";
import { CategoryRow, FilterBar } from "@/features/feed/FeedControls";
import { RestaurantGrid } from "@/features/feed/RestaurantGrid";
import { applyFilters, type FilterId } from "@/features/feed/filters";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./CollectionPage.module.css";

export function CategoryPage() {
  const { id = "" } = useParams();
  const { data: category, error } = useCategory(id);
  const { data: categories = [] } = useCategories();
  const { data: restaurants = [], isError, refetch } = useRestaurants();
  const mode = useCart((s) => s.mode);
  const area = useAddress((s) => s.current.area);
  const [active, setActive] = useState<Set<FilterId>>(new Set());
  useDocumentTitle(category?.label ?? "Category");

  const inCategory = useMemo(() => applyFilters(restaurants, id, new Set()), [restaurants, id]);
  const results = useMemo(() => applyFilters(restaurants, id, active), [restaurants, id, active]);

  const toggle = (f: FilterId) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container>
          {error instanceof NotFoundError ? (
            <EmptyState
              className={styles.missing}
              title="This category isn't on Kadé"
              description="The link may be old. Pick a category below, or search for a dish."
              action={<Button href="/browse">Browse categories</Button>}
            />
          ) : category ? (
            <>
              <CollectionBand
                title={category.label}
                imageId={category.imageId}
                description={`${plural(inCategory.length, "place")} ${
                  mode === "delivery" ? `deliver to ${area ?? "you"}` : "for pickup near you"
                }`}
              />
              <CategoryRow categories={categories} current={id} />
              <section className={styles.section} aria-labelledby="results-title">
                <SectionHeader id="results-title" title={`All ${category.label.toLowerCase()}`} />
                <FilterBar active={active} onToggle={toggle} />
                <div className={styles.results}>
                  {isError ? (
                    <EmptyState
                      title="Restaurants didn't load"
                      description="Check your connection, then try again."
                      action={<Chip onClick={() => void refetch()}>Try again</Chip>}
                    />
                  ) : results.length ? (
                    <RestaurantGrid restaurants={results} />
                  ) : inCategory.length ? (
                    <EmptyState
                      title="Nothing matches all of these filters"
                      description={`Remove a filter to see all ${plural(inCategory.length, "place")}.`}
                      action={<Chip onClick={() => setActive(new Set())}>Clear filters</Chip>}
                    />
                  ) : (
                    <EmptyState
                      title={`No ${category.label.toLowerCase()} near you yet`}
                      description="We're adding places every week. Search for a dish to see who else makes it."
                      action={<Button href="/search">Search dishes</Button>}
                    />
                  )}
                </div>
              </section>
            </>
          ) : null}
        </Container>
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
