import {
  Chip,
  Container,
  EmptyState,
  Icon,
  IconButton,
  Link,
  SearchField,
  Tabs,
  Tag,
  cx,
  formatRs,
  plural,
} from "@kade/ui";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { usePopularSearches, useSearch } from "@/api/queries";
import type { DishResult } from "@/api/types";
import { useCart } from "@/features/cart/store";
import { RestaurantGrid } from "@/features/feed/RestaurantGrid";
import { useRecentSearches } from "@/features/search/recent";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { etaLabel } from "@/lib/eta";
import { imageUrl } from "@/lib/images";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./SearchPage.module.css";

type TabId = "dishes" | "restaurants";

/** Keyed by the query, so a search started from the header resets the field. */
function SearchBox({ initial, onSearch }: { initial: string; onSearch: (q: string) => void }) {
  const [value, setValue] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(value);
  };
  return (
    <form role="search" className={styles.form} onSubmit={submit}>
      <SearchField
        label="Search dishes, restaurants or shops"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus={!initial}
        className={styles.field}
        enterKeyHint="search"
      />
    </form>
  );
}

function DishRow({ result: { item, restaurant } }: { result: DishResult }) {
  const mode = useCart((s) => s.mode);
  const unavailable = item.soldOut || !!restaurant.closedLabel;
  return (
    <li>
      <Link href={`/restaurant/${restaurant.id}?item=${item.id}`} className={styles.dish}>
        <span className={styles.thumb}>
          <img src={imageUrl(item.imageId ?? restaurant.imageId, 200, 200)} alt="" loading="lazy" />
        </span>
        <span className={styles.dishText}>
          <strong>
            {item.name}
            {item.unit ? `, ${item.unit}` : ""}
          </strong>
          <span>
            {restaurant.name}, {restaurant.closedLabel ?? etaLabel(restaurant.eta, mode)}
          </span>
          {item.soldOut && <Tag tone="hot">Sold out today</Tag>}
        </span>
        <span className={cx(styles.price, unavailable && styles.muted)}>{formatRs(item.price)}</span>
      </Link>
    </li>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q")?.trim() ?? "";
  useDocumentTitle(q ? `"${q}"` : "Search");

  const { data, isFetching, isError, refetch } = useSearch(q);
  const { data: popular = [] } = usePopularSearches();
  const recent = useRecentSearches();
  /** The tab someone picked, remembered only for the query they picked it on. */
  const [chosen, setChosen] = useState<{ q: string; tab: TabId } | null>(null);
  const setChosenTab = (t: TabId) => setChosen({ q, tab: t });

  // Every search lands here (hero, header, this page), so this is where it's remembered
  useEffect(() => {
    if (q) useRecentSearches.getState().add(q);
  }, [q]);

  const run = (term: string) => {
    const t = term.trim();
    if (!t) return;
    navigate(`/search?q=${encodeURIComponent(t)}`);
  };

  const results = data && data.query === q ? data : undefined;
  const dishes = results?.dishes ?? [];
  const places = results?.restaurants ?? [];
  // Open on whichever tab has something, unless the person picked one
  const tab: TabId =
    chosen?.q === q ? chosen.tab : dishes.length || !places.length ? "dishes" : "restaurants";
  const total = dishes.length + places.length;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          <h1 className="kd-visually-hidden">{q ? `Search results for ${q}` : "Search"}</h1>
          <SearchBox key={q} initial={q} onSearch={run} />

          <p className="kd-visually-hidden" aria-live="polite">
            {q && results
              ? total
                ? `${plural(dishes.length, "dish", "dishes")} and ${plural(places.length, "place")} for ${q}`
                : `No results for ${q}`
              : ""}
          </p>

          {!q ? (
            <div className={styles.start}>
              {recent.terms.length > 0 && (
                <section aria-labelledby="recent-title">
                  <div className={styles.headRow}>
                    <h2 id="recent-title" className={styles.heading}>
                      Recent searches
                    </h2>
                    <button type="button" className={styles.clear} onClick={recent.clear}>
                      Clear all
                    </button>
                  </div>
                  <ul className={styles.recent}>
                    {recent.terms.map((t) => (
                      <li key={t}>
                        <button type="button" className={styles.recentTerm} onClick={() => run(t)}>
                          <Icon name="clock" size={18} />
                          {t}
                        </button>
                        <IconButton
                          icon="close"
                          size="sm"
                          label={`Remove ${t} from recent searches`}
                          onClick={() => recent.remove(t)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section aria-labelledby="popular-title">
                <h2 id="popular-title" className={styles.heading}>
                  Popular in Colombo this week
                </h2>
                <div className={styles.chips}>
                  {popular.map((p) => (
                    <Chip key={p} onClick={() => run(p)}>
                      {p}
                    </Chip>
                  ))}
                </div>
              </section>
            </div>
          ) : isError ? (
            <EmptyState
              className={styles.empty}
              title="Search didn't load"
              description="Check your connection, then try again."
              action={<Chip onClick={() => void refetch()}>Try again</Chip>}
            />
          ) : !results ? (
            <p className={styles.loading}>{isFetching ? "Searching…" : ""}</p>
          ) : total === 0 ? (
            <EmptyState
              className={styles.empty}
              title={`Nothing on Kadé matches "${q}"`}
              description="Check the spelling, search for one word like kottu or rice, or try something people near you are ordering:"
              action={
                <div className={styles.chips}>
                  {popular.slice(0, 5).map((p) => (
                    <Chip key={p} onClick={() => run(p)}>
                      {p}
                    </Chip>
                  ))}
                </div>
              }
            />
          ) : (
            <Tabs
              className={styles.tabs}
              label="Search results"
              value={tab}
              onChange={setChosenTab}
              items={[
                { value: "dishes", label: "Dishes", count: dishes.length },
                { value: "restaurants", label: "Restaurants and shops", count: places.length },
              ]}
            >
              {tab === "dishes" ? (
                dishes.length ? (
                  <ul className={styles.dishes}>
                    {dishes.map((d) => (
                      <DishRow key={`${d.restaurant.id}-${d.item.id}`} result={d} />
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    title={`No dishes called "${q}"`}
                    description={`${plural(places.length, "place")} match, though. They're under Restaurants and shops.`}
                    action={<Chip onClick={() => setChosenTab("restaurants")}>See places</Chip>}
                  />
                )
              ) : places.length ? (
                <RestaurantGrid restaurants={places} />
              ) : (
                <EmptyState
                  title={`No restaurants called "${q}"`}
                  description={`${plural(dishes.length, "dish", "dishes")} match, though. They're under Dishes.`}
                  action={<Chip onClick={() => setChosenTab("dishes")}>See dishes</Chip>}
                />
              )}
            </Tabs>
          )}
        </Container>
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
