import { Icon, cx } from "@kade/ui";
import { useId } from "react";
import styles from "./FileField.module.css";

/** A document upload that shows what's attached, with room to replace it. Keeps the file name only. */
export function FileField({
  label,
  hint,
  value,
  onChange,
  error,
  accept = "application/pdf,image/jpeg,image/png",
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (fileName: string) => void;
  error?: string;
  accept?: string;
}) {
  const id = useId();
  return (
    <div className={cx(styles.field, value && styles.done, error && styles.error)}>
      <div className={styles.text}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        <p className={styles.hint} id={`${id}-hint`}>
          {value ? (
            <>
              <Icon name="check" size={16} /> {value}
            </>
          ) : (
            hint
          )}
        </p>
        {error && (
          <p className={styles.message} id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
      </div>
      <span className={styles.button}>
        <Icon name="upload" size={18} />
        {value ? "Replace" : "Upload"}
        <input
          id={id}
          type="file"
          accept={accept}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onChange(f.name);
          }}
        />
      </span>
    </div>
  );
}
