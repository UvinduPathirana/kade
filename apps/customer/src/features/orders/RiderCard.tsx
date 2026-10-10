import { Button, Rating, Sheet, TextField } from "@kade/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Order } from "@/api/types";
import styles from "./RiderCard.module.css";

const quickReplies = ["I'm at the gate", "Please call when you arrive", "Leave it with the security guard"];

interface Message {
  from: "me" | "rider";
  text: string;
}

function ChatSheet({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const rider = order.rider!;
  const [messages, setMessages] = useState<Message[]>([
    {
      from: "rider",
      text: `Hi, this is ${rider.name}. I'm bringing your order from ${order.restaurant.name}.`,
    },
  ]);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setMessages((m) => [...m, { from: "me", text: t }]);
    setDraft("");
    // Mock reply; the real one arrives over the order's chat channel
    window.setTimeout(
      () => setMessages((m) => [...m, { from: "rider", text: "Okay, noted. See you soon." }]),
      1200,
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Message ${rider.name}`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        send(draft);
      }}
      footer={
        <TextField
          className={styles.compose}
          label={`Message to ${rider.name}`}
          hideLabel
          placeholder="Write a message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          action={
            <Button type="submit" size="sm" disabled={!draft.trim()}>
              Send
            </Button>
          }
        />
      }
    >
      <p className={styles.chatNote}>Messages go through Kadé, so your number stays private.</p>
      <ol ref={listRef} className={styles.thread} aria-live="polite">
        {messages.map((m, i) => (
          <li key={i} className={m.from === "me" ? styles.mine : styles.theirs}>
            <span className="kd-visually-hidden">{m.from === "me" ? "You: " : `${rider.name}: `}</span>
            {m.text}
          </li>
        ))}
      </ol>
      <div className={styles.quick} role="group" aria-label="Quick replies">
        {quickReplies.map((q) => (
          <Button key={q} variant="secondary" size="sm" onClick={() => send(q)}>
            {q}
          </Button>
        ))}
      </div>
    </Sheet>
  );
}

/** Who is bringing the food, with a masked call and an in-app chat. */
export function RiderCard({ order, assigned }: { order: Order; assigned: boolean }) {
  const [chatOpen, setChatOpen] = useState(false);
  const rider = order.rider;
  if (!rider) return null;

  if (!assigned) {
    return (
      <div className={styles.card}>
        <div className={styles.avatar} aria-hidden="true" data-pending>
          ?
        </div>
        <p className={styles.text}>
          <strong>A rider is assigned once the kitchen accepts</strong>
          <span>You'll see who it is and can message them here.</span>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.avatar} aria-hidden="true">
        {rider.name[0]}
      </div>
      <p className={styles.text}>
        <strong>
          {rider.name} <Rating value={rider.rating} />
        </strong>
        <span>
          {rider.vehicle}, {rider.plate}
        </span>
      </p>
      <div className={styles.actions}>
        <Button
          href={`tel:${rider.maskedPhone.replace(/\s/g, "")}`}
          variant="secondary"
          size="sm"
          icon="phone"
          aria-label={`Call ${rider.name}`}
        >
          Call
        </Button>
        <Button variant="secondary" size="sm" icon="chat" onClick={() => setChatOpen(true)}>
          Message
        </Button>
      </div>
      <ChatSheet order={order} open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
