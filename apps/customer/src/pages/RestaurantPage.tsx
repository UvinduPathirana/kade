import { Button, Chip, ConfirmDialog, Container, EmptyState, SectionHeader } from "@kade/ui";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { NotFoundError } from "@/api/catalog";
import { useMenu, useRestaurant, useReviews } from "@/api/queries";
import type { MenuItem, Restaurant } from "@/api/types";
import { useCart, type CartRestaurant, type NewLine } from "@/features/cart/store";
import { ItemOptionsSheet, type AddResult } from "@/features/menu/ItemOptionsSheet";
import { MenuItemRow, PopularCard, ReviewCard } from "@/features/menu/MenuItems";
import { MenuNav } from "@/features/menu/MenuNav";
import { OrderBar, OrderPanel } from "@/features/menu/OrderPanel";
import { StoreHeader } from "@/features/menu/StoreHeader";
import { useScrollSpy } from "@/features/menu/useScrollSpy";
import { SiteHeader } from "@/layout/SiteHeader";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./RestaurantPage.module.css";

const snapshot = (r: Restaurant): CartRestaurant => ({
  id: r.id,
  name: r.name,
  imageId: r.imageId,
  eta: r.eta,
  deliveryFee: r.deliveryFee,
  discountPercent: r.discountPercent,
});

function RestaurantNotFound() {
  useDocumentTitle("Restaurant not found");
  return (
    <Container className={styles.notFound}>
      <h1>This restaurant isn't on Kadé</h1>
      <p>The link may be old, or the restaurant has left Kadé. Pick another place near you.</p>
      <Button href="/">See restaurants near you</Button>
    </Container>
  );
}

function RestaurantView({ restaurant }: { restaurant: Restaurant }) {
  useDocumentTitle(restaurant.name);
  const { data: menu } = useMenu(restaurant.id);
  const { data: reviews = [] } = useReviews(restaurant.id);
  const cartRestaurantId = useCart((s) => s.restaurant?.id);
  const lines = useCart((s) => s.lines);
  const addToCart = useCart((s) => s.add);
  const otherRestaurantName = useCart((s) => s.restaurant?.name);

  const [query, setQuery] = useState("");
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const [pending, setPending] = useState<{ line: NewLine; from: string } | null>(null);

  const q = query.trim().toLowerCase();
  const filteredSections = useMemo(
    () =>
      (menu?.sections ?? [])
        .map((s) => ({
          ...s,
          items: q
            ? s.items.filter((it) => `${it.name} ${it.description}`.toLowerCase().includes(q))
            : s.items,
        }))
        .filter((s) => s.items.length > 0),
    [menu, q],
  );

  const navSections = useMemo(
    () => [
      ...(q
        ? []
        : [
            { id: "popular", name: "Popular" },
            { id: "reviews", name: "Reviews" },
          ]),
      ...filteredSections.map((s) => ({ id: s.id, name: s.name })),
    ],
    [q, filteredSections],
  );
  const active = useScrollSpy(navSections.map((s) => s.id));

  // Quantity per dish, shown on its "+" button
  const qtyByItem = useMemo(() => {
    const m = new Map<string, number>();
    if (cartRestaurantId === restaurant.id)
      lines.forEach((l) => m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty));
    return m;
  }, [lines, cartRestaurantId, restaurant.id]);

  const onAdd = (line: NewLine): AddResult => {
    if (addToCart(snapshot(restaurant), line)) return "added";
    setOpenItem(null);
    setPending({ line, from: otherRestaurantName ?? "another restaurant" });
    return "conflict";
  };

  if (!menu) return null;

  return (
    <>
      <StoreHeader restaurant={restaurant} />
      <MenuNav sections={navSections} active={active} query={query} onQueryChange={setQuery} />

      <Container className={styles.body}>
        <div id="menu">
          {!q && (
            <>
              <section id="popular" className={styles.section} aria-labelledby="h-popular">
                <SectionHeader
                  id="h-popular"
                  title="Popular"
                  description="What people near you order most from here"
                />
                <div className={styles.popular}>
                  {menu.popular.slice(0, 4).map((it, i) => (
                    <PopularCard
                      key={it.id}
                      item={it}
                      rank={i + 1}
                      qty={qtyByItem.get(it.id) ?? 0}
                      onOpen={() => setOpenItem(it)}
                    />
                  ))}
                </div>
              </section>

              <section id="reviews" className={styles.section} aria-labelledby="h-reviews">
                <SectionHeader
                  id="h-reviews"
                  title="Reviews"
                  description={`${restaurant.rating} out of 5 from ${restaurant.ratingCount} ratings`}
                />
                <div className={styles.reviews}>
                  {reviews.map((rv) => (
                    <ReviewCard key={rv.id} review={rv} />
                  ))}
                </div>
              </section>
            </>
          )}

          {filteredSections.map((s) => (
            <section key={s.id} id={s.id} className={styles.section} aria-labelledby={`h-${s.id}`}>
              <SectionHeader id={`h-${s.id}`} title={s.name} />
              <div className={styles.items}>
                {s.items.map((it) => (
                  <MenuItemRow
                    key={it.id}
                    item={it}
                    qty={qtyByItem.get(it.id) ?? 0}
                    onOpen={() => setOpenItem(it)}
                  />
                ))}
              </div>
            </section>
          ))}

          {q && filteredSections.length === 0 && (
            <EmptyState
              className={styles.section}
              title={`No dishes match "${query.trim()}"`}
              description="Check the spelling, or search for an ingredient like chicken or cheese."
              action={<Chip onClick={() => setQuery("")}>Clear search</Chip>}
            />
          )}
        </div>

        <OrderPanel restaurant={restaurant} />
      </Container>

      <OrderBar restaurant={restaurant} />

      <ItemOptionsSheet
        item={openItem}
        optionGroups={menu.optionGroups}
        onClose={() => setOpenItem(null)}
        onAdd={onAdd}
      />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Start a new order?"
        description={`Your cart has dishes from ${pending?.from}. Adding from ${restaurant.name} will remove them.`}
        cancelLabel="Keep current cart"
        confirmLabel="Start new order"
        onConfirm={() => pending && addToCart(snapshot(restaurant), pending.line, { replace: true })}
      />
    </>
  );
}

export function RestaurantPage() {
  const id = Number(useParams().id);
  const { data: restaurant, error, refetch } = useRestaurant(id);

  return (
    <>
      <SiteHeader />
      <main id="main">
        {restaurant ? (
          <RestaurantView restaurant={restaurant} />
        ) : error instanceof NotFoundError || Number.isNaN(id) ? (
          <RestaurantNotFound />
        ) : error ? (
          <Container className={styles.notFound}>
            <EmptyState
              title="This menu didn't load"
              description="Check your connection, then try again."
              action={<Chip onClick={() => void refetch()}>Try again</Chip>}
            />
          </Container>
        ) : null}
      </main>
    </>
  );
}
