import { Button, Chip, Container, Icon, IconButton, Sheet, cx, formatRs } from "@kade/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { clockTime } from "@/api/orderStatus";
import { useOrders } from "@/api/queries";
import { AGENT, greeting, outgoing, sendMessage } from "@/api/support";
import type { ChatMessage, Order } from "@/api/types";
import { firstName, useSession } from "@/features/account/session";
import { itemsSummary, orderDate } from "@/features/orders/format";
import { useSupportChat } from "@/features/support/store";
import { SiteHeader } from "@/layout/SiteHeader";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useReducedMotion } from "@/lib/useReducedMotion";
import styles from "./SupportPage.module.css";

const quickTopics = [
  "Where's my order?",
  "Something was missing",
  "When will my refund arrive?",
  "I need to change my address",
  "I want to cancel",
];

type Attached = NonNullable<ChatMessage["order"]>;

const attachable = (o: Order): Attached => ({
  id: o.id,
  restaurant: o.restaurant.name,
  total: o.totals.total,
});

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.from === "you";
  return (
    <li className={cx(styles.message, mine ? styles.mine : styles.theirs)}>
      <span className="kd-visually-hidden">{mine ? "You said" : `${AGENT.name} said`}:</span>
      {message.order && (
        <span className={styles.orderCard}>
          <Icon name="receipt" size={18} />
          <span>
            <strong>Order {message.order.id}</strong>
            <span>
              {message.order.restaurant}, {formatRs(message.order.total)}
            </span>
          </span>
        </span>
      )}
      {message.text && <p>{message.text}</p>}
      <time className={styles.time} dateTime={new Date(message.at).toISOString()}>
        {clockTime(message.at)}
      </time>
    </li>
  );
}

export function SupportPage() {
  useDocumentTitle("Chat with support");
  const reduceMotion = useReducedMotion();
  const user = useSession((s) => s.user);
  const { messages, add, reset } = useSupportChat();
  const { data: orders = [] } = useOrders();
  const [params] = useSearchParams();
  const linkedOrder = orders.find((o) => o.id === params.get("order"));

  const [text, setText] = useState("");
  /** undefined: use the order from the link, if any; null: removed. */
  const [attachedChoice, setAttachedChoice] = useState<Attached | null | undefined>(undefined);
  const attached =
    attachedChoice === undefined ? (linkedOrder ? attachable(linkedOrder) : null) : attachedChoice;
  const [picking, setPicking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const reply = useMutation({ mutationFn: sendMessage, onSuccess: (m) => add(m) });
  // A new conversation starts with the agent's greeting
  const shown = messages.length ? messages : [greeting(firstName(user))];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: reduceMotion ? "auto" : "smooth" });
  }, [shown.length, reply.isPending, reduceMotion]);

  const send = (body: string) => {
    const t = body.trim();
    if (!t && !attached) return;
    if (!messages.length) reset(shown[0]!);
    const message = { text: t, order: attached ?? undefined };
    add(outgoing(message));
    reply.mutate(message);
    setText("");
    setAttachedChoice(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  return (
    <>
      <SiteHeader />
      <main id="main" className={styles.main}>
        <Container className={styles.page}>
          <header className={styles.head}>
            <span className={styles.avatar} aria-hidden="true">
              {AGENT.name[0]}
            </span>
            <div>
              <h1 className={styles.title}>
                {AGENT.name}, {AGENT.team}
              </h1>
              <p className={styles.sub}>Usually replies within 2 minutes, 7 am to midnight</p>
            </div>
            {messages.length > 1 && (
              <Button variant="secondary" size="sm" onClick={() => reset(greeting(firstName(user)))}>
                New chat
              </Button>
            )}
          </header>

          <ol className={styles.log} role="log" aria-live="polite" aria-label="Conversation">
            {shown.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
            {reply.isPending && (
              <li className={cx(styles.message, styles.theirs, styles.typing)}>
                <span className="kd-visually-hidden">{AGENT.name} is typing</span>
                <span className={styles.dots} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </li>
            )}
            {reply.isError && (
              <li className={styles.failed} role="alert">
                Your last message didn't send. Check your connection, then send it again.
              </li>
            )}
          </ol>

          {shown.length === 1 && (
            <div className={styles.topics} role="group" aria-label="Quick topics">
              {quickTopics.map((t) => (
                <Chip key={t} onClick={() => send(t)}>
                  {t}
                </Chip>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </Container>

        <form className={styles.composer} onSubmit={submit}>
          <Container className={styles.composerRow}>
            {attached && (
              <span className={styles.attached}>
                <Icon name="receipt" size={16} />
                Order {attached.id} attached
                <IconButton
                  icon="close"
                  size="sm"
                  label={`Remove order ${attached.id}`}
                  onClick={() => setAttachedChoice(null)}
                />
              </span>
            )}
            <div className={styles.inputRow}>
              <IconButton
                icon="receipt"
                label={attached ? "Attach a different order" : "Attach an order"}
                variant="soft"
                onClick={() => setPicking(true)}
                aria-haspopup="dialog"
              />
              <label className="kd-visually-hidden" htmlFor="chat-input">
                Message
              </label>
              <textarea
                ref={inputRef}
                id="chat-input"
                className={styles.input}
                rows={1}
                placeholder="Type a message"
                value={text}
                maxLength={1000}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter starts a new line
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(text);
                  }
                }}
              />
              <Button type="submit" disabled={!text.trim() && !attached}>
                Send
              </Button>
            </div>
          </Container>
        </form>
      </main>

      <Sheet open={picking} onOpenChange={setPicking} title="Attach an order">
        {orders.length ? (
          <ul className={styles.pick}>
            {orders.slice(0, 8).map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    setAttachedChoice(attachable(o));
                    setPicking(false);
                    inputRef.current?.focus();
                  }}
                >
                  <strong>
                    {o.restaurant.name}, {formatRs(o.totals.total)}
                  </strong>
                  <span>
                    {orderDate(o.placedAt)}. {itemsSummary(o)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.noOrders}>You haven't placed any orders on this device yet.</p>
        )}
      </Sheet>
    </>
  );
}
