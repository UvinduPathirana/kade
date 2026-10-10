// One polite place for screen-reader announcements about orders, rendered once by the app shell.
// Only events are announced (a new order, a minute left, a missed order), never every timer tick.
import { create } from "zustand";

interface AnnouncerState {
  message: string;
  /** Changes on every call so the same sentence twice is still read out. */
  seq: number;
  announce: (message: string) => void;
}

export const useAnnouncer = create<AnnouncerState>()((set) => ({
  message: "",
  seq: 0,
  announce: (message) => set((s) => ({ message, seq: s.seq + 1 })),
}));
