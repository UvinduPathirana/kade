import { Container, Link, Wordmark } from "@kade/ui";
import { useState } from "react";
import styles from "./SiteFooter.module.css";

const columns = [
  { title: "Work with us", links: ["Add your restaurant", "Deliver with Kadé", "Kadé for business"] },
  { title: "Ordering", links: ["Gift cards", "Kadé Plus", "Cities we deliver to"] },
  { title: "Help", links: ["Get help with an order", "Privacy", "Terms"] },
];

const languages = [
  { code: "en", label: "English" },
  { code: "si", label: "සිංහල" },
  { code: "ta", label: "தமிழ்" },
];

export function SiteFooter() {
  const [lang, setLang] = useState("en");
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
                  <li key={l}>
                    <Link href="#">{l}</Link>
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
                key={l.code}
                type="button"
                lang={l.code}
                aria-pressed={lang === l.code}
                onClick={() => setLang(l.code)}
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
