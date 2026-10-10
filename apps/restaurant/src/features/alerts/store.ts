// Sound preference for this tablet. Saved in localStorage: it's a device setting, not an account one.
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SoundState {
  /** The kitchen wants sound. Saved. */
  soundOn: boolean;
  /** The browser has let us play sound since this page loaded. Not saved: every load needs a tap. */
  unlocked: boolean;
  setSoundOn: (on: boolean) => void;
  setUnlocked: (unlocked: boolean) => void;
}

export const useSound = create<SoundState>()(
  persist(
    (set) => ({
      soundOn: true,
      unlocked: false,
      setSoundOn: (soundOn) => set({ soundOn }),
      setUnlocked: (unlocked) => set({ unlocked }),
    }),
    { name: "kade.partner.sound.v1", partialize: (s) => ({ soundOn: s.soundOn }) },
  ),
);
