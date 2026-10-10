import { cx } from "@kade/ui";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MAP_H, MAP_W, clampToMap } from "./geo";
import styles from "./PinMap.module.css";

/*
 * Illustrated map of Colombo's coast with a pin fixed in the centre: people drag the map (or use the
 * arrow keys) until the pin sits on their gate. A live map provider replaces the drawing later; the
 * pin-in-the-middle interaction stays the same.
 */

export interface PinMapProps {
  center: { x: number; y: number };
  onChange: (center: { x: number; y: number }) => void;
  /** Read out with the map, e.g. "Pin near Liberty Plaza, Kollupitiya". */
  description: string;
  invalid?: boolean;
}

const STEP = 24;

export function PinMap({ center, onChange, description, invalid }: PinMapProps) {
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: center.x, y: center.y };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    onChange(clampToMap({ x: d.x - (e.clientX - d.px), y: d.y - (e.clientY - d.py) }));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const move: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const m = move[e.key];
    if (!m) return;
    e.preventDefault();
    onChange(clampToMap({ x: center.x + m[0], y: center.y + m[1] }));
  };

  return (
    <div className={cx(styles.wrap, invalid && styles.invalid)}>
      <div
        className={cx(styles.viewport, dragging && styles.dragging)}
        tabIndex={0}
        role="group"
        aria-roledescription="map"
        aria-label={`Map. ${description}. Drag the map or use the arrow keys to move the pin; hold Shift to move further.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <svg
          className={styles.map}
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          width={MAP_W}
          height={MAP_H}
          style={{ left: `calc(50% - ${center.x}px)`, top: `calc(50% - ${center.y}px)` }}
          aria-hidden="true"
        >
          <rect width={MAP_W} height={MAP_H} className={styles.land} />
          <path
            className={styles.sea}
            d="M0 0 H250 C246 120 268 250 262 360 C256 520 280 660 284 800 C290 1000 300 1200 296 1400 H0 Z"
          />
          <path
            className={styles.rail}
            d="M268 0 C264 120 286 250 280 360 C274 520 298 660 302 800 C308 1000 318 1200 314 1400"
          />
          <path
            className={styles.lake}
            d="M400 280 C440 250 500 270 520 300 C540 340 500 370 470 360 C440 352 420 380 396 350 C380 330 384 296 400 280 Z"
          />

          <rect className={styles.park} x="520" y="432" width="90" height="78" rx="12" />
          <rect className={styles.park} x="618" y="664" width="84" height="70" rx="12" />
          <rect className={styles.park} x="506" y="1226" width="80" height="66" rx="12" />
          <rect className={styles.park} x="282" y="218" width="40" height="70" rx="10" />

          <g className={styles.blocks}>
            <rect x="350" y="560" width="70" height="60" rx="8" />
            <rect x="470" y="700" width="90" height="70" rx="8" />
            <rect x="600" y="300" width="110" height="90" rx="8" />
            <rect x="790" y="520" width="120" height="110" rx="8" />
            <rect x="400" y="1050" width="110" height="80" rx="8" />
            <rect x="600" y="920" width="130" height="90" rx="8" />
            <rect x="800" y="1100" width="120" height="120" rx="8" />
          </g>

          <g className={styles.roads}>
            <path d="M330 140 C335 400 350 700 360 1000 S380 1300 385 1400" />
            <path d="M430 330 C440 600 450 900 455 1150 L470 1400" />
            <path d="M760 0 C760 300 750 600 760 1000 L790 1400" />
            <path d="M480 640 C500 800 520 1000 520 1200" />
            <path d="M330 140 L500 60 L640 0" />
            <path d="M300 236 L560 230 L760 200" />
            <path d="M340 470 L760 470 L1000 460" />
            <path d="M350 650 L760 640 L1000 650" />
            <path d="M360 820 L760 820" />
            <path d="M370 990 L760 1000 L1000 1010" />
            <path d="M380 1238 L1000 1250" />
            <path d="M560 430 L560 230" />
          </g>
          <path className={styles.minor} d="M300 400 C306 700 312 1000 318 1250" />

          <g className={styles.labels}>
            <text x="352" y="128">
              Fort
            </text>
            <text x="440" y="44">
              Pettah
            </text>
            <text x="478" y="400">
              Slave Island
            </text>
            <text x="380" y="440">
              Kollupitiya
            </text>
            <text x="560" y="560">
              Cinnamon Gardens
            </text>
            <text x="790" y="400">
              Borella
            </text>
            <text x="384" y="700">
              Bambalapitiya
            </text>
            <text x="560" y="880">
              Havelock Town
            </text>
            <text x="790" y="760">
              Narahenpita
            </text>
            <text x="390" y="940">
              Wellawatte
            </text>
            <text x="420" y="1200">
              Dehiwala
            </text>
          </g>
          <g className={styles.roadLabels}>
            <text x="346" y="880" transform="rotate(87 346 880)">
              Galle Rd
            </text>
            <text x="452" y="760" transform="rotate(88 452 760)">
              Duplication Rd
            </text>
            <text x="772" y="280" transform="rotate(90 772 280)">
              Baseline Rd
            </text>
          </g>
          <text className={styles.seaLabel} x="150" y="820" transform="rotate(-86 150 820)">
            Indian Ocean
          </text>
        </svg>

        <div className={styles.pin} aria-hidden="true">
          <span className={styles.drop} />
          <span className={styles.shadow} />
        </div>
      </div>
      <p className={styles.hint} aria-live="polite">
        {description}
      </p>
    </div>
  );
}
