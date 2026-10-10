import * as RadixDialog from "@radix-ui/react-dialog";
import { useLayoutEffect, useRef, type FormEvent, type ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Button } from "../Button/Button";
import { IconButton } from "../IconButton/IconButton";
import styles from "./Overlay.module.css";

/*
 * Every overlay is a Radix Dialog underneath: focus is trapped while open, Escape and the backdrop
 * close it, focus returns to the control that opened it, and the title labels the dialog.
 */

/**
 * Radix returns focus only to a Dialog.Trigger. Our overlays open from app state (a cart button, a
 * menu item), so remember whatever had focus when the overlay opened and give focus back on close.
 * Layout effects run before Radix moves focus into the dialog, so this captures the opener.
 */
function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);
  return (event: Event) => {
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) {
      event.preventDefault();
      el.focus();
    }
  };
}

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children?: ReactNode;
}

/* ---------- Drawer: slides in from the right (cart) ---------- */

export interface DrawerProps extends BaseProps {
  footer?: ReactNode;
  closeLabel?: string;
}

export function Drawer({ open, onOpenChange, title, footer, closeLabel = "Close", children }: DrawerProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.scrim} />
        <RadixDialog.Content
          onCloseAutoFocus={returnFocus}
          className={styles.drawer}
          aria-describedby={undefined}
        >
          <div className={styles.drawerHead}>
            <RadixDialog.Title className={styles.drawerTitle}>{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton icon="close" label={closeLabel} />
            </RadixDialog.Close>
          </div>
          <div className={styles.drawerBody}>{children}</div>
          {footer && <div className={styles.drawerFoot}>{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/* ---------- Sheet: centred on desktop, rises from the bottom on phones (item options) ---------- */

export interface SheetProps extends BaseProps {
  /** Full-bleed media above the title, e.g. the dish photo. */
  media?: ReactNode;
  /** Sticky footer, e.g. quantity stepper + "Add to order". */
  footer?: ReactNode;
  /** Wrap body + footer in a form so Enter submits and the footer button can be type="submit". */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  closeLabel?: string;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  media,
  footer,
  onSubmit,
  closeLabel = "Close",
  children,
}: SheetProps) {
  const returnFocus = useReturnFocus(open);
  const inner = (
    <>
      <div className={styles.sheetScroll}>
        {media && <div className={styles.sheetMedia}>{media}</div>}
        <div className={cx(styles.sheetBody, !media && styles.sheetBodyNoMedia)}>
          <RadixDialog.Title className={styles.sheetTitle}>{title}</RadixDialog.Title>
          {children}
        </div>
      </div>
      {footer && <div className={styles.sheetFoot}>{footer}</div>}
    </>
  );
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={cx(styles.scrim, styles.scrimCentered)}>
          <RadixDialog.Content
            onCloseAutoFocus={returnFocus}
            className={styles.sheet}
            aria-describedby={undefined}
          >
            <RadixDialog.Close asChild>
              <IconButton icon="close" label={closeLabel} variant="overlay" className={styles.sheetClose} />
            </RadixDialog.Close>
            {onSubmit ? (
              <form className={styles.sheetForm} onSubmit={onSubmit} noValidate>
                {inner}
              </form>
            ) : (
              <div className={styles.sheetForm}>{inner}</div>
            )}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/* ---------- ConfirmDialog: a short yes/no decision ---------- */

export interface ConfirmDialogProps extends BaseProps {
  description: ReactNode;
  /** Names the action exactly: "Start new order", not "OK". */
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={cx(styles.scrim, styles.scrimCentered)}>
          <RadixDialog.Content onCloseAutoFocus={returnFocus} className={styles.confirm}>
            <RadixDialog.Title className={styles.confirmTitle}>{title}</RadixDialog.Title>
            <RadixDialog.Description className={styles.confirmText}>{description}</RadixDialog.Description>
            <div className={styles.confirmActions}>
              <RadixDialog.Close asChild>
                <Button variant="secondary">{cancelLabel}</Button>
              </RadixDialog.Close>
              <Button
                autoFocus
                onClick={() => {
                  onConfirm();
                  onOpenChange(false);
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
