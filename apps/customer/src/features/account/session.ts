// The signed-in customer, kept on this device. Later the auth service issues a token and this holds it.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/api/types";

interface SessionState {
  user: User | null;
  signIn: (user: User) => void;
  signOut: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      signIn: (user) => set({ user }),
      signOut: () => set({ user: null }),
    }),
    { name: "kade.session.v1" },
  ),
);

export const firstName = (user: User | null | undefined) => user?.name.trim().split(/\s+/)[0] ?? "";

/** Where to send someone after signing in: only paths inside the app. */
export const safeNext = (next: string | null) => (next && /^\/(?!\/)/.test(next) ? next : "/");
