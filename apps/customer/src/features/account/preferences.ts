// Language and notification choices. Later synced to the customer service so they follow the account.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Language = "en" | "si" | "ta";

export const languages: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "si", label: "සිංහල" },
  { value: "ta", label: "தமிழ்" },
];

export type NotificationId = "offers" | "sms" | "receipts" | "groups";

interface PreferencesState {
  language: Language;
  notifications: Record<NotificationId, boolean>;
  setLanguage: (language: Language) => void;
  setNotification: (id: NotificationId, on: boolean) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      language: "en",
      notifications: { offers: true, sms: true, receipts: true, groups: true },
      // Only English text exists so far, so the page's lang attribute stays "en" until translations ship
      setLanguage: (language) => set({ language }),
      setNotification: (id, on) => set((s) => ({ notifications: { ...s.notifications, [id]: on } })),
    }),
    { name: "kade.preferences.v1" },
  ),
);
