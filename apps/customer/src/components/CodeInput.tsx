import { cx } from "@kade/ui";
import { useId } from "react";
import styles from "./CodeInput.module.css";

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  length?: number;
  error?: string;
  disabled?: boolean;
}

/**
 * One real input (so paste, SMS autofill and screen readers all work) drawn as a row of cells.
 * The cells are decoration; the input sits invisibly on top of them.
 */
export function CodeInput({ value, onChange, label, length = 6, error, disabled }: CodeInputProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={styles.wrap} data-state={error ? "error" : undefined}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.field}>
        <input
          id={id}
          className={styles.input}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={length}
          value={value}
          disabled={disabled}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
        />
        <div className={styles.cells} aria-hidden="true">
          {Array.from({ length }, (_, i) => (
            <span
              key={i}
              className={cx(
                styles.cell,
                (i === value.length || (i === length - 1 && value.length === length)) && styles.active,
              )}
            >
              {value[i] ?? ""}
            </span>
          ))}
        </div>
      </div>
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
