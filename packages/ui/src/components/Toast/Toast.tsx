import { useCallback, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../icons/Icon";
import { cx } from "../../lib/cx";
import styles from "./Toast.module.css";

import { ToastContext, type ToastOptions } from "./toastContext";

export type { ToastOptions };

interface ToastItem extends ToastOptions {
  id: number;
}

/** Wrap an app once; then call useToast()({ title }) anywhere. Toasts are announced politely. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (t: ToastOptions) => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.action ? 7000 : 4000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx(styles.toast, t.tone && styles[t.tone])}>
            {t.tone === "success" && <Icon name="check" size={18} />}
            {t.tone === "error" && <Icon name="alert" size={18} />}
            <div className={styles.text}>
              <strong>{t.title}</strong>
              {t.description && <span>{t.description}</span>}
            </div>
            {t.action && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
