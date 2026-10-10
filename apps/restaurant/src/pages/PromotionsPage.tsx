import { Button, ConfirmDialog, EmptyState, Tabs, Tag, formatRs, plural, useToast } from "@kade/ui";
import { useState } from "react";
import { offerState, todayIso, type OfferState } from "@/api/promotions";
import { useEndOffer, useMenu, useOffers } from "@/api/queries";
import type { Menu, Offer } from "@/api/types";
import { OfferForm } from "@/features/promotions/OfferForm";
import { offerTerms, offerTitle, offerTypeLabels } from "@/features/promotions/offerText";
import { shortDate } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./PromotionsPage.module.css";

const stateCopy: Record<OfferState, string> = { active: "Active", scheduled: "Scheduled", ended: "Ended" };

export function PromotionsPage() {
  useDocumentTitle("Promotions");
  const { data: offers, isPending, isError, refetch } = useOffers();
  const { data: menu } = useMenu();
  const [tab, setTab] = useState<OfferState>("active");
  const [creating, setCreating] = useState(false);

  if (creating)
    return (
      <div className={styles.page}>
        <OfferForm
          menu={menu}
          onDone={(created) => {
            setCreating(false);
            if (created) setTab(created.startDate > todayIso() ? "scheduled" : "active");
          }}
        />
      </div>
    );

  const today = todayIso();
  const byState = (s: OfferState) => (offers ?? []).filter((o) => offerState(o, today) === s);
  const shown = byState(tab);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Promotions</h1>
          <p className={styles.muted}>
            Offers bring customers in. You fund the discount, up to the budget you set.
          </p>
        </div>
        <Button size="lg" icon="plus" onClick={() => setCreating(true)}>
          Create offer
        </Button>
      </header>

      {isPending && <p className={styles.muted}>Loading offers…</p>}
      {isError && (
        <EmptyState
          title="Offers didn't load"
          description="Check the tablet's connection and try again."
          action={<Button onClick={() => void refetch()}>Try again</Button>}
        />
      )}
      {offers && (
        <Tabs
          label="Offers"
          value={tab}
          onChange={setTab}
          items={(["active", "scheduled", "ended"] as const).map((s) => ({
            value: s,
            label: stateCopy[s],
            count: byState(s).length,
          }))}
        >
          {shown.length ? (
            <ul className={styles.list}>
              {shown.map((o) => (
                <OfferRow key={o.id} offer={o} state={tab} menu={menu} />
              ))}
            </ul>
          ) : (
            <EmptyState
              title={tab === "ended" ? "No past offers yet" : `No ${stateCopy[tab].toLowerCase()} offers`}
              description={
                tab === "ended"
                  ? "Offers move here when they end or their budget runs out."
                  : "Restaurants with an offer get about a third more orders on Kadé."
              }
              action={
                tab !== "ended" ? (
                  <Button icon="plus" onClick={() => setCreating(true)}>
                    Create offer
                  </Button>
                ) : undefined
              }
            />
          )}
        </Tabs>
      )}
    </div>
  );
}

function OfferRow({ offer, state, menu }: { offer: Offer; state: OfferState; menu?: Menu }) {
  const toast = useToast();
  const end = useEndOffer();
  const [confirming, setConfirming] = useState(false);
  const used = Math.min(1, offer.spent / offer.budget);
  const title = offerTitle(offer, menu);
  const ranOut = state === "ended" && offer.spent >= offer.budget;

  return (
    <li className={styles.offer}>
      <div className={styles.main}>
        <div className={styles.offerHead}>
          <Tag tone={state === "active" ? "offer" : state === "scheduled" ? "warning" : "neutral"} size="md">
            {stateCopy[state]}
          </Tag>
          <span className={styles.type}>{offerTypeLabels[offer.type]}</span>
        </div>
        <h2 className={styles.offerTitle}>{title}</h2>
        <p className={styles.muted}>
          {shortDate(offer.startDate)} to {shortDate(offer.endDate)}
          {offer.endedAt && `, ended early on ${shortDate(offer.endedAt)}`}
          {ranOut && ", budget used up"}. {offerTerms({ ...offer, endDate: "" })}
        </p>
      </div>

      <div className={styles.numbers}>
        <p>
          <strong>{plural(offer.orders, "order")}</strong>
          <span>used it</span>
        </p>
        <div className={styles.budget}>
          <p>
            <strong>{formatRs(offer.spent)}</strong> <span>of {formatRs(offer.budget)} budget</span>
          </p>
          <div
            className={styles.meter}
            role="meter"
            aria-label="Budget used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(used * 100)}
          >
            <span style={{ width: `${used * 100}%` }} />
          </div>
        </div>
      </div>

      {state !== "ended" && (
        <>
          <Button variant="outline" size="lg" onClick={() => setConfirming(true)} className={styles.action}>
            {state === "active" ? "End offer" : "Cancel offer"}
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={state === "active" ? `End ${title} now?` : `Cancel ${title}?`}
            description={
              state === "active"
                ? "Customers stop seeing it straight away. Orders already placed keep their discount."
                : "It won't start. You can create it again later."
            }
            cancelLabel="Keep offer"
            confirmLabel={state === "active" ? "End offer" : "Cancel offer"}
            onConfirm={() =>
              end.mutate(offer.id, {
                onSuccess: () =>
                  toast({ title: state === "active" ? "Offer ended" : "Offer cancelled", tone: "success" }),
                onError: (e) => toast({ title: "Offer not changed", description: e.message, tone: "error" }),
              })
            }
          />
        </>
      )}
    </li>
  );
}
