import { Chip, Container, EmptyState, SectionHeader, Shelf, TextLink, plural } from "@kade/ui";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useCategories, useRestaurants } from "@/api/queries";
import type { Restaurant } from "@/api/types";
import { useCart } from "@/features/cart/store";
import { LiveOrderBanner, PlusStrip } from "@/features/feed/Banners";
import { CategoryRow, FilterBar } from "@/features/feed/FeedControls";
import { applyFilters, type FilterId } from "@/features/feed/filters";
import { Hero } from "@/features/feed/Hero";
import { RestaurantTile } from "@/features/feed/RestaurantTile";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./HomePage.module.css";

function ShelfSection({
  id,
  title,
  description,
  restaurants,
  actions,
  arrows = true,
}: {
  id: string;
  title: string;
  description?: string;
  restaurants: Restaurant[];
  actions?: ReactNode;
  arrows?: boolean;
}) {
  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <Shelf
        label={title.toLowerCase()}
        arrows={arrows}
        actions={actions}
        header={(controls) => (
          <SectionHeader id={`${id}-title`} title={title} description={description} actions={controls} />
        )}
      >
        {restaurants.map((r) => (
          <RestaurantTile key={r.id} restaurant={r} />
        ))}
      </Shelf>
    </section>
  );
}

export function HomePage() {
  useDocumentTitle();
  const { data: categories = [] } = useCategories();
  const { data: restaurants = [], isError, refetch } = useRestaurants();
  const mode = useCart((s) => s.mode);
  const [active, setActive] = useState<Set<FilterId>>(new Set());
  const [heroSearchVisible, setHeroSearchVisible] = useState(true);
  const onSearchVisibleChange = useCallback((v: boolean) => setHeroSearchVisible(v), []);

  const shelves = useMemo(() => {
    const open = restaurants.filter((r) => !r.closedLabel);
    return {
      offers: open.filter((r) => r.offer),
      again: restaurants.filter((r) => r.orderedBefore),
      fast: [...open].sort((a, b) => a.eta[0] - b.eta[0]).slice(0, 8),
    };
  }, [restaurants]);

  const results = useMemo(() => applyFilters(restaurants, "all", active), [restaurants, active]);

  const toggleFilter = (id: FilterId) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearFilters = () => setActive(new Set());

  return (
    <>
      <SiteHeader showModeToggle withSearch showSearch={!heroSearchVisible} />
      <main id="main">
        <Container>
          <Hero onSearchVisibleChange={onSearchVisibleChange} />
          <CategoryRow categories={categories} />
          <FilterBar active={active} onToggle={toggleFilter} />
          <LiveOrderBanner />

          {isError ? (
            <EmptyState
              className={styles.section}
              title="Restaurants didn't load"
              description="Check your connection, then try again."
              action={<Chip onClick={() => void refetch()}>Try again</Chip>}
            />
          ) : (
            <>
              <ShelfSection
                id="offers"
                title="Offers near you"
                description="Discounts end at 11 pm tonight"
                restaurants={shelves.offers}
                actions={<TextLink href="/offers">See all</TextLink>}
              />
              <ShelfSection
                id="again"
                title="Order again"
                restaurants={shelves.again}
                arrows={false}
                actions={<TextLink href="/orders">Past orders</TextLink>}
              />
              <PlusStrip />
              <ShelfSection
                id="fast"
                title="Quickest to your door"
                description="Kitchens within 2 km of Galle Rd"
                restaurants={shelves.fast}
              />

              <section className={styles.section} aria-labelledby="all-title">
                <SectionHeader
                  id="all-title"
                  title="All restaurants and shops"
                  description={`${plural(results.length, "place")} ${mode === "delivery" ? "deliver to you" : "for pickup near you"}`}
                />
                {results.length ? (
                  <div className={styles.grid}>
                    {results.map((r) => (
                      <RestaurantTile key={r.id} restaurant={r} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Nothing matches all of these filters"
                    description="Remove a filter to see more places, or pick a category above."
                    action={<Chip onClick={clearFilters}>Clear filters</Chip>}
                  />
                )}
              </section>
            </>
          )}
        </Container>
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
