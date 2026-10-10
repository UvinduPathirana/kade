import { createContext, useContext } from "react";

export interface ToastOptions {
  /** Names what happened in the past tense of the action: "Order accepted", "Menu saved". */
  title: string;
  description?: string;
  tone?: "neutral" | "success" | "error";
  /** Optional single action, e.g. Undo. */
  action?: { label: string; onClick: () => void };
}

export const ToastContext = createContext<((t: ToastOptions) => void) | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
