import { Container, Link, Wordmark } from "@kade/ui";
import { languages, usePreferences } from "@/features/account/preferences";
import { PARTNER_LINKS } from "@/lib/partnerLinks";
import styles from "./SiteFooter.module.css";

const columns: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Work with us",
    links: [
      { label: "Add your restaurant", href: PARTNER_LINKS.restaurant },
      { label: "Deliver with Kadé", href: PARTNER_LINKS.rider },
      { label: "Refer a friend", href: "/gifts#refer" },
    ],
  },
  {
    title: "Ordering",
    links: [
      { label: "Gift cards", href: "/gifts" },
      { label: "Kadé Plus", href: "/plus" },
      { label: "Where we deliver", href: "/welcome#areas" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Get help with an order", href: "/help" },
      { label: "Chat with support", href: "/support" },
      { label: "Privacy and terms", href: "/help#privacy" },
    ],
  },
];

export function SiteFooter() {
  const lang = usePreferences((s) => s.language);
  const setLang = usePreferences((s) => s.setLanguage);
  return (
    <footer className={styles.footer}>
      <Container>
        <div className={styles.grid}>
          <div className={styles.brand}>
            <Wordmark size="lg" />
            <p className={styles.tag}>Colombo's restaurants, bakeries and corner shops, delivered.</p>
          </div>
          {columns.map((c) => (
            <div key={c.title}>
              <h3>{c.title}</h3>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className={styles.base}>
          <span>© 2026 Kadé (Pvt) Ltd, Colombo</span>
          <div className={styles.lang} role="group" aria-label="Language">
            {languages.map((l) => (
              <button
                key={l.value}
                type="button"
                lang={l.value}
                aria-pressed={lang === l.value}
                onClick={() => setLang(l.value)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}
