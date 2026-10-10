import {
  Button,
  Container,
  EmptyState,
  Icon,
  IconButton,
  Link,
  Panel,
  SegmentedControl,
  Switch,
  TextField,
  formatRs,
  useToast,
} from "@kade/ui";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { AccountError, formatPhone, plusActive, plusRenewsAt } from "@/api/account";
import {
  useAddresses,
  useCards,
  useCredit,
  usePlus,
  useRemoveAddress,
  useRemoveCard,
  useRestaurants,
  useSaveProfile,
} from "@/api/queries";
import type { User } from "@/api/types";
import { AddCardSheet } from "@/features/account/AddCardSheet";
import { languages, usePreferences, type NotificationId } from "@/features/account/preferences";
import { useSession } from "@/features/account/session";
import { useAddress } from "@/features/address/store";
import { RestaurantGrid } from "@/features/feed/RestaurantGrid";
import { useFavourites } from "@/features/feed/favourites";
import { SiteFooter } from "@/layout/SiteFooter";
import { SiteHeader } from "@/layout/SiteHeader";
import { TabBar } from "@/layout/TabBar";
import { cardLabel } from "@/lib/cards";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./AccountPage.module.css";

const longDate = (ms: number) => new Date(ms).toLocaleDateString("en-LK", { day: "numeric", month: "long" });

const notificationRows: { id: NotificationId; label: string; description: string }[] = [
  {
    id: "sms",
    label: "Text me when the rider is close",
    description: "About 2 minutes before they reach you",
  },
  { id: "groups", label: "Group order invites", description: "When a friend adds you to a group order" },
  { id: "offers", label: "Offers and new places", description: "At most two a week" },
  { id: "receipts", label: "Email receipts", description: "Sent to the email on your profile" },
];

function Profile({ user }: { user: User }) {
  const toast = useToast();
  const signIn = useSession((s) => s.signIn);
  const save = useSaveProfile();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user);
  const [error, setError] = useState<string | undefined>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const saved = await save.mutateAsync(draft);
      signIn(saved);
      setEditing(false);
      toast({ title: "Profile saved", tone: "success" });
    } catch (err) {
      setError(err instanceof AccountError ? err.message : "Your changes weren't saved. Try again.");
    }
  };

  return (
    <Panel
      title="Profile"
      titleId="profile-title"
      action={
        !editing && (
          <Button
            variant="secondary"
            size="sm"
            icon="edit"
            onClick={() => {
              setDraft(user);
              setError(undefined);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )
      }
    >
      {editing ? (
        <form className={styles.form} onSubmit={submit} noValidate>
          <TextField
            label="Name"
            autoComplete="name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            error={error}
          />
          <TextField
            label="Email for receipts"
            type="email"
            autoComplete="email"
            value={draft.email ?? ""}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
          <p className={styles.muted}>
            {user.phone
              ? `To change your mobile number, sign out and sign in with the new one.`
              : "You signed in with Google or Apple, so there's no mobile number on this account yet."}
          </p>
          <div className={styles.row}>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save profile"}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className={styles.facts}>
          <div>
            <dt>Name</dt>
            <dd>{user.name}</dd>
          </div>
          {user.phone && (
            <div>
              <dt>Mobile</dt>
              <dd>{formatPhone(user.phone)}</dd>
            </div>
          )}
          <div>
            <dt>Email</dt>
            <dd>{user.email ?? "Not added"}</dd>
          </div>
        </dl>
      )}
    </Panel>
  );
}

function Addresses() {
  const toast = useToast();
  const { data: addresses = [] } = useAddresses();
  const remove = useRemoveAddress();
  const current = useAddress((s) => s.current);
  const openPicker = useAddress((s) => s.setPickerOpen);
  return (
    <Panel
      title="Saved addresses"
      titleId="addresses-title"
      action={
        <Button variant="secondary" size="sm" icon="plus" onClick={() => openPicker(true)}>
          Add
        </Button>
      }
    >
      {addresses.length ? (
        <ul className={styles.list}>
          {addresses.map((a) => (
            <li key={a.id}>
              <Icon name={a.id === "home" ? "home" : a.id === "work" ? "store" : "pin"} />
              <span>
                <strong>
                  {a.label}
                  {a.id === current.id && <span className={styles.current}>Delivering here</span>}
                </strong>
                <span>{a.line}</span>
                {a.note && <span>Rider note: {a.note}</span>}
              </span>
              <IconButton
                icon="trash"
                size="sm"
                label={`Remove ${a.label}, ${a.line}`}
                onClick={() =>
                  remove.mutate(a.id, {
                    onSuccess: () => toast({ title: "Address removed", description: a.line }),
                  })
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>No saved addresses. Add one so checkout is one tap.</p>
      )}
    </Panel>
  );
}

function Cards() {
  const toast = useToast();
  const { data: cards = [] } = useCards();
  const remove = useRemoveCard();
  const [adding, setAdding] = useState(false);
  return (
    <Panel
      title="Payment methods"
      titleId="cards-title"
      action={
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          onClick={() => setAdding(true)}
          aria-haspopup="dialog"
        >
          Add a card
        </Button>
      }
    >
      <ul className={styles.list}>
        {cards.map((c) => (
          <li key={c.id}>
            <Icon name="card" />
            <span>
              <strong>{cardLabel(c)}</strong>
              <span>Expires {c.expiry}</span>
            </span>
            <IconButton
              icon="trash"
              size="sm"
              label={`Remove ${cardLabel(c)}`}
              onClick={() =>
                remove.mutate(c.id, {
                  onSuccess: () => toast({ title: "Card removed", description: cardLabel(c) }),
                })
              }
            />
          </li>
        ))}
        <li>
          <Icon name="cash" />
          <span>
            <strong>Cash on delivery</strong>
            <span>Always available at checkout</span>
          </span>
        </li>
      </ul>
      <AddCardSheet open={adding} onClose={() => setAdding(false)} />
    </Panel>
  );
}

/** Kadé credit is the account page's turmeric surface: it's money, and it's theirs. */
function Credit() {
  const { data: credit } = useCredit();
  if (!credit) return null;
  return (
    <section className={styles.credit} aria-labelledby="credit-title">
      <h2 id="credit-title" className={styles.creditLabel}>
        Kadé credit
      </h2>
      <p className={styles.balance}>{formatRs(credit.balance)}</p>
      <p>Comes off your next order at checkout. You can switch it off there.</p>
      {credit.history.length > 0 && (
        <details className={styles.history}>
          <summary>
            Credit history
            <Icon name="chevronDown" size={16} />
          </summary>
          <ul>
            {credit.history.map((h) => (
              <li key={h.id}>
                <span>
                  {h.label}
                  <small>{longDate(h.at)}</small>
                </span>
                <strong>
                  {h.amount > 0 ? "+" : "−"} {formatRs(Math.abs(h.amount))}
                </strong>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Link href="/gifts#refer" className={styles.creditLink}>
        Get Rs 500 for every friend who orders
      </Link>
    </section>
  );
}

export function AccountPage() {
  useDocumentTitle("Account");
  const navigate = useNavigate();
  const toast = useToast();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const { data: plus } = usePlus();
  const favouriteIds = useFavourites((s) => s.ids);
  const { data: restaurants = [] } = useRestaurants();
  const { language, setLanguage, notifications, setNotification } = usePreferences();

  if (!user) return <Navigate to="/signin?next=/account" replace />;
  const favourites = restaurants.filter((r) => favouriteIds.includes(r.id));
  const member = plusActive(plus);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className={styles.page}>
          <h1 className={styles.title}>{user.name}</h1>

          <div className={styles.layout}>
            <div className={styles.main}>
              <Profile user={user} />
              <Addresses />
              <Cards />

              <section aria-labelledby="fav-title" className={styles.favs}>
                <h2 id="fav-title" className={styles.sectionTitle}>
                  Favourites
                </h2>
                {favourites.length ? (
                  <RestaurantGrid restaurants={favourites} />
                ) : (
                  <EmptyState
                    title="No favourites yet"
                    description="Tap the heart on any restaurant and it'll be saved here."
                    action={<Button href="/">Browse restaurants</Button>}
                  />
                )}
              </section>

              <Panel title="Notifications" titleId="notif-title">
                <div className={styles.switches}>
                  <Switch
                    checked
                    disabled
                    onChange={() => undefined}
                    label="Order updates"
                    description="Accepted, on its way, delivered. Always on while you have an order."
                  />
                  {notificationRows.map((n) => (
                    <Switch
                      key={n.id}
                      checked={notifications[n.id]}
                      onChange={(on) => setNotification(n.id, on)}
                      label={n.label}
                      description={
                        n.id === "receipts" && !user.email
                          ? "Add an email to your profile first"
                          : n.description
                      }
                      disabled={n.id === "receipts" && !user.email}
                    />
                  ))}
                </div>
              </Panel>

              <Panel title="Language" titleId="lang-title">
                <SegmentedControl
                  label="Language"
                  options={languages}
                  value={language}
                  onChange={setLanguage}
                />
                <p className={styles.muted}>
                  {language === "en"
                    ? "Restaurants write their menus in English, Sinhala or Tamil; Kadé itself is in English."
                    : "Kadé is in English for now. Sinhala and Tamil are being translated, and the app switches over automatically when they're ready."}
                </p>
              </Panel>
            </div>

            <aside className={styles.aside}>
              <Credit />
              <Panel title="Kadé Plus" titleId="plus-title">
                <p className={styles.muted}>
                  {member && plus
                    ? plus.status === "cancelled"
                      ? `Cancelled. Benefits last until ${longDate(plus.endsAt!)}.`
                      : `Member. Next payment ${longDate(plusRenewsAt(plus))}, ${plus.cardLabel}.`
                    : "No delivery fee on orders over Rs 1,500. First month free."}
                </p>
                <Button href="/plus" variant="outline" size="sm" className={styles.plusBtn}>
                  {member ? "Manage Plus" : "Try Plus free"}
                </Button>
              </Panel>
              <Panel title="Gifts and invites" titleId="gifts-title">
                <p className={styles.muted}>Send a gift card, or invite friends for Rs 500 each.</p>
                <Button href="/gifts" variant="outline" size="sm" className={styles.plusBtn}>
                  Gift cards and invites
                </Button>
              </Panel>
              <Button
                variant="secondary"
                icon="logout"
                fullWidth
                onClick={() => {
                  signOut();
                  toast({ title: "Signed out", description: "Your cart is still saved on this device." });
                  navigate("/");
                }}
              >
                Sign out
              </Button>
            </aside>
          </div>
        </Container>
      </main>
      <SiteFooter />
      <TabBar />
    </>
  );
}
