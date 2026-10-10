import { Button, Icon, SegmentedControl, cx } from "@kade/ui";
import { useEffect, useRef, useState } from "react";
import { modeOptions } from "@/features/cart/mode";
import { useCart } from "@/features/cart/store";
import { imageUrl, photos } from "@/lib/images";
import { useReducedMotion } from "@/lib/useReducedMotion";
import styles from "./Hero.module.css";

const dishes = [
  {
    dish: "Kottu,",
    eta: "22 minutes away.",
    imageId: photos.kottu,
    place: "Galle Road Kottu House",
    meta: "Rs 1,150 for a chicken kottu",
  },
  {
    dish: "Fish curry,",
    eta: "34 minutes away.",
    imageId: photos.fishCurry,
    place: "Negombo Fish Curry Co.",
    meta: "Rs 1,600 with red rice",
  },
  {
    dish: "Fish buns,",
    eta: "14 minutes away.",
    imageId: photos.buns,
    place: "Kompanna Short Eats",
    meta: "Rs 140 each, still warm",
  },
  {
    dish: "Biryani,",
    eta: "29 minutes away.",
    imageId: photos.biryani,
    place: "Marine Drive Biryani",
    meta: "Rs 1,450 for chicken biryani",
  },
];

const suggestions = ["lamprais", "isso wade", "watalappan"];
const ROTATE_MS = 4200;
const LEAVE_MS = 320;
const ENTER_MS = 650;

type Phase = "idle" | "leaving" | "entering";

export interface HeroProps {
  /** Called with false once the hero search scrolls under the header, so the header can show its own. */
  onSearchVisibleChange?: (visible: boolean) => void;
}

/** The turmeric band: the page's one bold surface and its one piece of ambient motion. */
export function Hero({ onSearchVisibleChange }: HeroProps) {
  const reduceMotion = useReducedMotion();
  const mode = useCart((s) => s.mode);
  const setMode = useCart((s) => s.setMode);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [query, setQuery] = useState("");
  const paused = useRef(false);
  const bandRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Preload every plate so the swap never shows a blank circle
  useEffect(() => {
    dishes.forEach((d) => {
      new Image().src = imageUrl(d.imageId, 800, 800);
    });
  }, []);

  // Rotate dishes; pause while someone is using the hero or the tab is hidden
  useEffect(() => {
    if (reduceMotion) return;
    const timers: number[] = [];
    const id = window.setInterval(() => {
      if (paused.current || document.hidden) return;
      setPhase("leaving");
      timers.push(
        window.setTimeout(() => {
          setIndex((i) => (i + 1) % dishes.length);
          setPhase("entering");
          timers.push(window.setTimeout(() => setPhase("idle"), ENTER_MS));
        }, LEAVE_MS),
      );
    }, ROTATE_MS);
    return () => {
      window.clearInterval(id);
      timers.forEach(window.clearTimeout);
    };
  }, [reduceMotion]);

  useEffect(() => {
    const el = searchRef.current;
    if (!el || !onSearchVisibleChange) return;
    const io = new IntersectionObserver(([entry]) => onSearchVisibleChange(!!entry?.isIntersecting), {
      rootMargin: "-72px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [onSearchVisibleChange]);

  const d = dishes[index]!;
  const phaseClass =
    phase === "leaving" ? styles.leaving : phase === "entering" ? styles.entering : undefined;

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div
        ref={bandRef}
        className={styles.band}
        onFocus={() => (paused.current = true)}
        onBlur={(e) => {
          if (!bandRef.current?.contains(e.relatedTarget as Node)) paused.current = false;
        }}
      >
        <div className={styles.copy}>
          <SegmentedControl
            className={styles.mode}
            label="Order type"
            options={modeOptions}
            value={mode}
            onChange={setMode}
            onColor
          />

          <h1 id="hero-title" className={cx(styles.title, phaseClass)} aria-live="polite">
            <span className={styles.line}>
              <span>{d.dish}</span>
            </span>
            <span className={cx(styles.line, styles.eta)}>
              <span>{d.eta}</span>
            </span>
          </h1>

          <form
            ref={searchRef}
            role="search"
            className={styles.search}
            onSubmit={(e) => {
              e.preventDefault();
              // Search results page comes in Phase 2
            }}
          >
            <Icon name="search" />
            <label className="kd-visually-hidden" htmlFor="hero-q">
              Search dishes, restaurants or shops
            </label>
            <input
              ref={inputRef}
              id="hero-q"
              type="search"
              autoComplete="off"
              placeholder="Search dishes, restaurants or shops"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" variant="ink" className={styles.submit} aria-label="Find food">
              <span className={styles.submitText}>Find food</span>
              <Icon name="arrowRight" className={styles.submitIcon} />
            </Button>
          </form>

          <p className={styles.tries}>
            Or try{" "}
            {suggestions.map((s, i) => (
              <span key={s}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(s);
                    inputRef.current?.focus();
                  }}
                >
                  {s}
                </button>
                {i < suggestions.length - 2 ? ", " : i === suggestions.length - 2 ? " or " : "."}
              </span>
            ))}
          </p>
        </div>

        <div className={cx(styles.plate, phaseClass)} aria-hidden="true">
          <img src={imageUrl(d.imageId, 800, 800)} alt="" />
          <div className={styles.ticket}>
            <strong>{d.place}</strong>
            <span>{d.meta}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
