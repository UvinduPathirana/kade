import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Icon } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import styles from "./Form.module.css";

/* ---------- Choice: one radio or checkbox row ---------- */

export interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  type: "radio" | "checkbox";
  label: ReactNode;
  /** Right-aligned detail, e.g. "+ Rs 150". */
  meta?: ReactNode;
}

export const Choice = forwardRef<HTMLInputElement, ChoiceProps>(function Choice(
  { type, label, meta, className, ...rest },
  ref,
) {
  return (
    <label className={cx(styles.choice, className)}>
      <input ref={ref} type={type} className={styles.choiceInput} {...rest} />
      <span className={cx(styles.mark, type === "checkbox" && styles.markBox)} aria-hidden="true" />
      <span className={styles.choiceLabel}>{label}</span>
      {meta && <span className={styles.choiceMeta}>{meta}</span>}
    </label>
  );
});

/* ---------- ChoiceGroup: fieldset with required/optional hint and an error ---------- */

export interface ChoiceGroupProps {
  legend: string;
  /** "Required" or "Optional, up to 4". */
  hint: string;
  required?: boolean;
  /** Required and something is chosen: hint turns leaf. */
  complete?: boolean;
  /** Shown under the choices and announced, e.g. "Choose spice level to continue." */
  error?: string;
  children: ReactNode;
  className?: string;
}

export const ChoiceGroup = forwardRef<HTMLFieldSetElement, ChoiceGroupProps>(function ChoiceGroup(
  { legend, hint, required, complete, error, children, className },
  ref,
) {
  const errorId = useId();
  return (
    <fieldset
      ref={ref}
      className={cx(styles.group, className)}
      data-state={error ? "error" : complete ? "complete" : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className={styles.legend}>
        <strong>{legend}</strong>
        <span className={cx(styles.hint, required && styles.hintRequired)}>{hint}</span>
      </legend>
      <div className={styles.list}>{children}</div>
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
});

/* ---------- TextArea ---------- */

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextArea({ label, className, ...rest }: TextAreaProps) {
  return (
    <label className={cx(styles.field, className)}>
      <strong>{label}</strong>
      <textarea className={styles.textarea} {...rest} />
    </label>
  );
}

/* ---------- SearchField: compact search pill ---------- */

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Accessible label; also used as the placeholder unless one is given. */
  label: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { label, placeholder, className, ...rest },
  ref,
) {
  return (
    <label className={cx(styles.search, className)}>
      <Icon name="search" size={18} />
      <span className="kd-visually-hidden">{label}</span>
      <input ref={ref} type="search" placeholder={placeholder ?? label} autoComplete="off" {...rest} />
    </label>
  );
});
