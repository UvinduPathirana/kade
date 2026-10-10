import { Container, Icon, Link, SearchField, SectionHeader, type IconName } from "@kade/ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useCategories } from "@/api/queries";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { imageUrl } from "@/lib/images";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./CollectionPage.module.css";

const collections: { href: string; title: string; detail: string; icon: IconName }[] = [
  { href: "/offers", title: "Offers near you", detail: "Discounts and promo codes", icon: "tag" },
  { href: "/restaurant/15", title: "Kadé Market", detail: "Groceries in 20 to 35 minutes", icon: "grocery" },
  { href: "/plus", title: "Kadé Plus", detail: "No delivery fee over Rs 1,500", icon: "star" },
  { href: "/gifts", title: "Gift cards", detail: "Send a meal to someone", icon: "gift" },
];

/** The phone tab bar's Browse: search, every category and the collections. */
export function BrowsePage() {
  useDocumentTitle("Browse");
  const navigate = useNavigate();
  const { data: categories = [] } = useCategories();
  const [q, setQ] = useState("");

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container>
          <h1 className={styles.title}>Browse</h1>
          <form
            role="search"
            className={styles.search}
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <SearchField
              label="Search dishes, restaurants or shops"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={styles.searchField}
              enterKeyHint="search"
            />
          </form>

          <section className={styles.section} aria-labelledby="cats-title">
            <SectionHeader id="cats-title" title="Categories" />
            <ul className={styles.categoryGrid}>
              {categories
                .filter((c) => c.id !== "all")
                .map((c) => (
                  <li key={c.id}>
                    <Link href={`/category/${c.id}`} className={styles.categoryTile}>
                      <img src={imageUrl(c.imageId, 200, 200)} alt="" loading="lazy" />
                      {c.label}
                    </Link>
                  </li>
                ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="coll-title">
            <SectionHeader id="coll-title" title="Collections" />
            <ul className={styles.collections}>
              {collections.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} className={styles.collection}>
                    <Icon name={c.icon} />
                    <span>
                      <strong>{c.title}</strong>
                      <small>{c.detail}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </Container>
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
