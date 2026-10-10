import { Button, Container, Icon, Link, Wordmark, cx, useToast } from "@kade/ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { DELIVERY_ZONE, comingNext, deliveryAreas, joinWaitlist } from "@/api/addresses";
import { usePlaces } from "@/api/queries";
import type { Place } from "@/api/types";
import { useSession } from "@/features/account/session";
import { useAddress } from "@/features/address/store";
import { SiteFooter } from "@/layout/SiteFooter";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useHashScroll } from "@/lib/useHashScroll";
import { PARTNER_LINKS } from "@/lib/partnerLinks";
import styles from "./WelcomePage.module.css";

const steps = [
  {
    title: "Pick a place",
    text: "Restaurants, bakeries and corner shops near you, with the delivery time shown first.",
  },
  { title: "Order and pay", text: "Card, or cash to the rider. Schedule it for later if you'd rather." },
  {
    title: "Follow it to your gate",
    text: "See the kitchen accept, the rider pick up, and the minutes count down.",
  },
];

/** Address search for the hero: in the zone goes straight to the feed; outside offers to save it. */
function AddressEntry() {
  const navigate = useNavigate();
  const toast = useToast();
  const setCurrent = useAddress((s) => s.setCurrent);
  const [query, setQuery] = useState("");
  const [outside, setOutside] = useState<Place | null>(null);
  const [saved, setSaved] = useState(false);
  const { data: places = [], isFetching } = usePlaces(query);
  const showList = query.trim().length >= 2 && !outside;

  const choose = (p: Place) => {
    if (!p.inZone) {
      setOutside(p);
      setSaved(false);
      return;
    }
    setCurrent({
      id: `place-${p.id}`,
      label: p.name,
      line: `${p.name}, ${p.detail.split(", ").pop()}`,
      area: p.area,
      pin: p.pin,
    });
    toast({
      title: `Delivering to ${p.name}`,
      description: "Add a house number from the address button any time.",
    });
    navigate("/");
  };

  return (
    <div className={styles.entry}>
      <label htmlFor="welcome-address" className={styles.entryLabel}>
        Where should we deliver?
      </label>
      <div className={styles.field}>
        <Icon name="pin" />
        <input
          id="welcome-address"
          type="search"
          autoComplete="off"
          placeholder="Street, building or area, like Liberty Plaza"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOutside(null);
          }}
          aria-controls="welcome-places"
        />
      </div>
      <p className="kd-visually-hidden" aria-live="polite">
        {showList && !isFetching ? `${places.length} ${places.length === 1 ? "place" : "places"} found` : ""}
      </p>
      {showList && places.length > 0 && (
        <ul id="welcome-places" className={styles.places}>
          {places.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => choose(p)}>
                <strong>{p.name}</strong>
                <span>{p.inZone ? p.detail : `${p.detail}, outside our area for now`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {showList && !isFetching && places.length === 0 && (
        <p className={styles.note}>
          No places match "{query.trim()}". Try an area like Wellawatte, or{" "}
          <Link href="/">browse restaurants</Link> and set your address later.
        </p>
      )}
      {outside && (
        <div className={styles.outside} aria-live="polite">
          <p>
            <strong>Not in {outside.name} yet.</strong> Kadé delivers in {DELIVERY_ZONE}.
          </p>
          {saved ? (
            <p className={styles.saved}>
              <Icon name="check" size={18} /> Saved. We'll tell you when we start delivering in {outside.name}
              .
            </p>
          ) : (
            <Button
              variant="ink"
              size="sm"
              onClick={async () => {
                await joinWaitlist(outside);
                setSaved(true);
              }}
            >
              Tell me when you deliver to {outside.name}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function WelcomePage() {
  useDocumentTitle("Food delivery in Colombo");
  useHashScroll();
  const signedIn = useSession((s) => !!s.user);

  return (
    <>
      <header className={styles.top}>
        <Container className={styles.topRow}>
          <Wordmark />
          <nav aria-label="Account" className={styles.topLinks}>
            <Link href="/">Browse restaurants</Link>
            {!signedIn && (
              <Button href="/signin" variant="secondary" size="sm">
                Sign in
              </Button>
            )}
          </nav>
        </Container>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="welcome-title">
          <Container className={styles.heroRow}>
            <div className={styles.heroCopy}>
              <h1 id="welcome-title" className={styles.title}>
                Dinner from Pettah to Dehiwala.
              </h1>
              <p className={styles.lead}>
                Colombo's restaurants, bakeries and corner shops, at your gate in about 30 minutes. Pay by
                card or cash.
              </p>
              <AddressEntry />
            </div>
            {/* The districts as a route board: decoration, the real list is below */}
            <ol className={styles.board} aria-hidden="true">
              {deliveryAreas.map((a) => (
                <li key={a.code}>
                  <span>{a.code}</span>
                  {a.name}
                </li>
              ))}
            </ol>
          </Container>
        </section>

        <Container>
          <section className={styles.section} aria-labelledby="how-title">
            <h2 id="how-title" className={styles.heading}>
              How it works
            </h2>
            <ol className={styles.steps}>
              {steps.map((s, i) => (
                <li key={s.title}>
                  <span className={styles.stepNo} aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section id="areas" className={cx(styles.section, styles.areas)} aria-labelledby="areas-title">
            <div>
              <h2 id="areas-title" className={styles.heading}>
                Where we deliver
              </h2>
              <p className={styles.muted}>
                Every Colombo postal district and Dehiwala. Next up: {comingNext.join(", ")}.
              </p>
            </div>
            <ul className={styles.areaList}>
              {deliveryAreas.map((a) => (
                <li key={a.code}>
                  <span>Colombo {a.code}</span>
                  {a.name}
                </li>
              ))}
              <li>
                <span>South of Colombo 06</span>
                Dehiwala
              </li>
            </ul>
          </section>

          <section className={cx(styles.section, styles.partners)} aria-label="Work with Kadé">
            <article className={styles.partner}>
              <Icon name="store" />
              <h2>Add your restaurant</h2>
              <p>
                Reach hungry people across Colombo. You set the menu and the hours; we send the riders and pay
                out every week.
              </p>
              <a className={styles.partnerLink} href={PARTNER_LINKS.restaurant}>
                Partner with Kadé
              </a>
            </article>
            <article className={styles.partner}>
              <Icon name="bike" />
              <h2>Deliver with Kadé</h2>
              <p>
                Ride when it suits you, on a motorbike, tuk-tuk or bicycle. Weekly pay, and you keep every
                tip.
              </p>
              <a className={styles.partnerLink} href={PARTNER_LINKS.rider}>
                Sign up to ride
              </a>
            </article>
          </section>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
