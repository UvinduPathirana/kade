import { Button, Sheet, TextField } from "@kade/ui";
import { useState } from "react";
import { useSendSupportMessage } from "@/api/queries";
import type { ChatMessage } from "@/api/types";
import { clockTime } from "@/lib/time";
import styles from "./SupportChat.module.css";

const STARTERS = ["Customer isn't answering", "Restaurant is very late", "My pay looks wrong"];

/** Chat with rider support. Messages are a mock; the support service will stream real replies. */
export function SupportChat({
  open,
  onOpenChange,
  topic,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  topic?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const send = useSendSupportMessage();

  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setDraft("");
    send.mutate(t, { onSuccess: ({ sent, reply }) => setMessages((m) => [...m, sent, reply]) });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Rider support"
      onSubmit={(e) => {
        e.preventDefault();
        submit(draft);
      }}
      footer={
        <div className={styles.compose}>
          <TextField
            label="Message"
            hideLabel
            placeholder="Type a message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={styles.input}
          />
          <Button type="submit" size="lg" disabled={!draft.trim() || send.isPending}>
            Send
          </Button>
        </div>
      }
    >
      <p className={styles.intro}>
        We reply in about 2 minutes, any time of day.{topic ? ` About: ${topic}.` : ""}
      </p>
      <ol className={styles.log} role="log" aria-live="polite" aria-label="Conversation">
        {messages.map((m) => (
          <li key={m.id} className={m.from === "rider" ? styles.mine : styles.theirs}>
            <span className="kd-visually-hidden">{m.from === "rider" ? "You" : "Support"}: </span>
            {m.text}
            <span className={styles.time}>{clockTime(m.at)}</span>
          </li>
        ))}
        {send.isPending && (
          <>
            <li className={styles.mine}>
              <span className="kd-visually-hidden">You: </span>
              {send.variables}
              <span className={styles.time}>Sending</span>
            </li>
            <li className={styles.typing}>Support is typing…</li>
          </>
        )}
      </ol>
      {messages.length === 0 && !send.isPending && (
        <div className={styles.starters}>
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.starter}
              onClick={() => submit(topic ? `${topic}: ${s}` : s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
