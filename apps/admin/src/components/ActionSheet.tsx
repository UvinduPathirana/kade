import { Button, ConfirmDialog, Sheet } from "@kade/ui";
import { useState, type ReactNode } from "react";
import u from "./ui.module.css";
import styles from "./ActionSheet.module.css";

export interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Names the action exactly: "Refund Rs 1,150", "Suspend rider". */
  submitLabel: string;
  children: ReactNode;
  /** Return a sentence saying what to fix, or null when the form is ready. */
  validate?: () => string | null;
  /** Destructive actions ask once more before they run. */
  confirm?: { title: string; description: ReactNode; confirmLabel: string };
  onSubmit: () => Promise<unknown>;
  pending?: boolean;
}

/**
 * A form in a sheet for one decision (refund, cancel, suspend…). Mount it only while open so each
 * use starts from a clean form. Failures stay in the sheet and say what to do next.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  submitLabel,
  children,
  validate,
  confirm,
  onSubmit,
  pending,
}: ActionSheetProps) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = async () => {
    try {
      await onSubmit();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Try again.");
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        onSubmit={(e) => {
          e.preventDefault();
          const problem = validate?.() ?? null;
          setError(problem);
          if (problem) return;
          if (confirm) setConfirming(true);
          else void run();
        }}
        footer={
          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </div>
        }
      >
        <div className={styles.body}>
          {error && (
            <p className={u.formError} role="alert">
              {error}
            </p>
          )}
          {children}
        </div>
      </Sheet>
      {confirm && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          cancelLabel="Go back"
          onConfirm={() => void run()}
        />
      )}
    </>
  );
}
