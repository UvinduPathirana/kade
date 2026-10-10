// The open support conversation, kept on this device so it survives a reload.
// Later the support service keeps the transcript.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage } from "@/api/types";

interface ChatState {
  messages: ChatMessage[];
  add: (message: ChatMessage) => void;
  reset: (first: ChatMessage) => void;
}

export const useSupportChat = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      add: (message) => set((s) => ({ messages: [...s.messages, message] })),
      reset: (first) => set({ messages: [first] }),
    }),
    { name: "kade.support.v1" },
  ),
);
