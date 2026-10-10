import {
  Button,
  Chip,
  ConfirmDialog,
  Container,
  EmptyState,
  SectionHeader,
  SegmentedControl,
  Stepper,
  Tag,
  cx,
  formatRs,
} from "@kade/ui";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMenu } from "@/api/queries";
import type { MenuItem, Restaurant } from "@/api/types";
import { cartSnapshot, useCart, type NewLine } from "@/features/cart/store";
import { MenuNav } from "@/features/menu/MenuNav";
import { OrderBar, OrderPanel } from "@/features/menu/OrderPanel";
import { useScrollSpy } from "@/features/menu/useScrollSpy";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { substitutionOptions, useSubstitution } from "./substitution";
import styles from "./ShopView.module.css";

const productLine = (item: MenuItem): NewLine => ({
  itemId: item.id,
  name: item.unit ? `${item.name}, ${item.unit}` : item.name,
  unitPrice: item.price,
  qty: 1,
  choices: [],
  note: "",
});

/** Products have no options, so their cart key is just the item id. */
const productKey = (item: MenuItem) => `${item.id}|`;

function ProductTile({
  item,
  qty,
  onAdd,
  onQty,
}: {
  item: MenuItem;
  qty: number;
  onAdd: () => void;
  onQty: (q: number) => void;
}) {
  const label = item.unit ? `${item.name}, ${item.unit}` : item.name;
  return (
    <li id={`product-${item.id}`} className={cx(styles.product, item.soldOut && styles.out)}>
      <div className={styles.tag}>
        <strong className={styles.name}>{item.name}</strong>
        {item.unit && <span className={styles.unit}>{item.unit}</span>}
        <span className={styles.price}>{formatRs(item.price)}</span>
        {item.description && <span className={styles.desc}>{item.description}</span>}
      </div>
      <div className={styles.control}>
        {item.soldOut ? (
          <span className={styles.soldOut}>Out of stock today</span>
        ) : qty > 0 ? (
          <Stepper value={qty} onChange={onQty} label={`Quantity of ${label}`} itemName={label} size="md" />
        ) : (
          <Button variant="outline" size="sm" icon="plus" onClick={onAdd} aria-label={`Add ${label}`}>
            Add
          </Button>
        )}
      </div>
    </li>
  );
}

/** Kadé Market and other shops: aisles, products by pack size, quick add without an options sheet. */
export function ShopView({ restaurant }: { restaurant: Restaurant }) {
  useDocumentTitle(restaurant.name);
  const { data: menu } = useMenu(restaurant.id);
  const lines = useCart((s) => s.lines);
  const cartRestaurantId = useCart((s) => s.restaurant?.id);
  const otherName = useCart((s) => s.restaurant?.name);
  const add = useCart((s) => s.add);
  const setQty = useCart((s) => s.setQty);
  const substitution = useSubstitution((s) => s.value);
  const setSubstitution = useSubstitution((s) => s.set);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{ line: NewLine; from: string } | null>(null);
  const [params] = useSearchParams();
  const linkedId = params.get("item");

  // A product opened from search results: bring it into view and put focus on its Add button
  useEffect(() => {
    if (!menu || !linkedId) return;
    const el = document.getElementById(`product-${linkedId}`);
    el?.scrollIntoView({ block: "center" });
    el?.querySelector("button")?.focus({ preventScroll: true });
  }, [menu, linkedId]);

  const q = query.trim().toLowerCase();
  const aisles = useMemo(
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
  const active = useScrollSpy(aisles.map((s) => s.id));

  const qtyByKey = useMemo(() => {
    const m = new Map<string, number>();
    if (cartRestaurantId === restaurant.id) lines.forEach((l) => m.set(l.key, l.qty));
    return m;
  }, [lines, cartRestaurantId, restaurant.id]);

  const addProduct = (item: MenuItem) => {
    const line = productLine(item);
    if (!add(cartSnapshot(restaurant), line)) setPending({ line, from: otherName ?? "another restaurant" });
  };

  if (!menu) return null;
  const chosen = substitutionOptions.find((o) => o.value === substitution)!;

  return (
    <>
      <Container>
        <section className={styles.band} aria-labelledby="shop-title">
          <div>
            <h1 id="shop-title" className={styles.title}>
              {restaurant.name}
            </h1>
            <p className={styles.promise}>
              Groceries to your door in {restaurant.eta[0]}–{restaurant.eta[1]} min.{" "}
              {restaurant.deliveryFee ? `${formatRs(restaurant.deliveryFee)} delivery.` : "No delivery fee."}{" "}
              Open {restaurant.hours}.
            </p>
            {restaurant.offer && (
              <Tag tone="offer" icon="tag" size="md" className={styles.offer}>
                {restaurant.offer}
              </Tag>
            )}
          </div>
          <div className={styles.subs}>
            <p className={styles.subsLabel}>If something's out of stock</p>
            <SegmentedControl
              label="If something's out of stock"
              options={substitutionOptions.map(({ value, label }) => ({ value, label }))}
              value={substitution}
              onChange={setSubstitution}
              onColor
            />
            <p className={styles.subsDetail}>
              {chosen.detail}. Your picker messages you before swapping anything.
            </p>
          </div>
        </section>
      </Container>

      <MenuNav
        sections={aisles.map((s) => ({ id: s.id, name: s.name }))}
        active={active}
        query={query}
        onQueryChange={setQuery}
        label="Aisles"
        searchLabel="Search the shop"
      />

      <Container className={styles.body}>
        <div>
          {aisles.map((aisle) => (
            <section key={aisle.id} id={aisle.id} className={styles.aisle} aria-labelledby={`h-${aisle.id}`}>
              <SectionHeader id={`h-${aisle.id}`} title={aisle.name} />
              <ul className={styles.grid}>
                {aisle.items.map((it) => (
                  <ProductTile
                    key={it.id}
                    item={it}
                    qty={qtyByKey.get(productKey(it)) ?? 0}
                    onAdd={() => addProduct(it)}
                    onQty={(n) => setQty(productKey(it), n)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {q && aisles.length === 0 && (
            <EmptyState
              className={styles.aisle}
              title={`Nothing in the shop matches "${query.trim()}"`}
              description="Try a simpler word, like rice, milk or onions."
              action={<Chip onClick={() => setQuery("")}>Clear search</Chip>}
            />
          )}
        </div>
        <OrderPanel restaurant={restaurant} />
      </Container>

      <OrderBar restaurant={restaurant} />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Start a new order?"
        description={`Your cart has dishes from ${pending?.from}. Adding from ${restaurant.name} will remove them.`}
        cancelLabel="Keep current cart"
        confirmLabel="Start new order"
        onConfirm={() => pending && add(cartSnapshot(restaurant), pending.line, { replace: true })}
      />
    </>
  );
}
