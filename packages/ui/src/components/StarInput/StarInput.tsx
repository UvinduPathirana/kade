import { useId, useState } from "react";
import { Icon } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import styles from "./StarInput.module.css";

export interface StarInputProps {
  value: number;
  onChange: (value: number) => void;
  /** Group label, e.g. "Rate Nimal's delivery". */
  label: string;
  /** Words for 1–5 stars, shown under the stars once picked. */
  descriptions?: [string, string, string, string, string];
  size?: "md" | "lg";
  className?: string;
}

const defaultWords: [string, string, string, string, string] = ["Bad", "Not great", "Okay", "Good", "Great"];

/** 1–5 star picker built on radio inputs, so arrow keys move between stars. */
export function StarInput({
  value,
  onChange,
  label,
  descriptions = defaultWords,
  size = "lg",
  className,
}: StarInputProps) {
  const name = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset className={cx(styles.group, styles[size], className)}>
      <legend className="kd-visually-hidden">{label}</legend>
      <div className={styles.stars} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={styles.star} onMouseEnter={() => setHover(n)}>
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              aria-label={`${n} ${n === 1 ? "star" : "stars"}, ${descriptions[n - 1]}`}
            />
            <Icon
              name="star"
              size={size === "lg" ? 36 : 26}
              filled={n <= shown}
              className={cx(n <= shown && styles.on)}
            />
          </label>
        ))}
      </div>
      <p className={styles.word} aria-hidden="true">
        {shown ? descriptions[shown - 1] : " "}
      </p>
    </fieldset>
  );
}
