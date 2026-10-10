import {
  Button,
  Choice,
  DataTable,
  IconButton,
  Select,
  Switch,
  Tabs,
  TextField,
  cx,
  useToast,
  type Column,
} from "@kade/ui";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { matchRule, type HomeContent } from "@/api/content";
import {
  useHomeContent,
  useMoveCategory,
  useMoveCollection,
  useSaveCollection,
  useSetCollectionVisible,
  useUpdateCategory,
} from "@/api/queries";
import type { Collection, CollectionRule, HomeCategory } from "@/api/types";
import { ActionSheet } from "@/components/ActionSheet";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Status } from "@/components/Status";
import u from "@/components/ui.module.css";
import { formatDate } from "@/lib/format";
import { imageUrl } from "@/lib/images";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./ContentPage.module.css";

type Tab = "categories" | "collections";
const TODAY = "2026-10-10";

const liveOn = (c: Collection, day: string) =>
  c.visible && c.startsOn <= day && (!c.endsOn || c.endsOn >= day);

function schedule(c: Collection) {
  if (c.startsOn > TODAY) return <Status tone="progress">Starts {formatDate(c.startsOn)}</Status>;
  if (c.endsOn && c.endsOn < TODAY) return <Status tone="done">Ended {formatDate(c.endsOn)}</Status>;
  return (
    <span className={u.cellStack}>
      <Status tone={c.visible ? "live" : "done"}>{c.visible ? "Live" : "Hidden"}</Status>
      <span>{c.endsOn ? `Until ${formatDate(c.endsOn)}` : "No end date"}</span>
    </span>
  );
}

function ruleSummary(rule: CollectionRule | undefined, categories: HomeCategory[]) {
  if (!rule) return "";
  const parts = [
    rule.category && categories.find((c) => c.id === rule.category)?.label,
    rule.minRating && `${rule.minRating}★ and up`,
    rule.maxEta && `here in ${rule.maxEta} min or less`,
    rule.offersOnly && "has an offer",
  ].filter(Boolean);
  return parts.join(", ");
}

/* ---------- Image picker ---------- */

function ImageSheet({
  category,
  images,
  onClose,
}: {
  category: HomeCategory;
  images: HomeContent["images"];
  onClose: () => void;
}) {
  const toast = useToast();
  const mutation = useUpdateCategory();
  const [chosen, setChosen] = useState(category.imageId);
  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Image for ${category.label}`}
      submitLabel="Use this image"
      pending={mutation.isPending}
      onSubmit={async () => {
        await mutation.mutateAsync({ id: category.id, imageId: chosen });
        toast({ title: "Image changed", description: category.label, tone: "success" });
      }}
    >
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>Photo library</legend>
        <div className={styles.imageGrid}>
          {images.map((img) => (
            <label key={img.id} className={cx(styles.imageOption, chosen === img.id && styles.imageChosen)}>
              <input
                type="radio"
                name="image"
                value={img.id}
                checked={chosen === img.id}
                onChange={() => setChosen(img.id)}
                className="kd-visually-hidden"
              />
              <img src={imageUrl(img.id, 160, 120)} alt="" loading="lazy" />
              <span>{img.name.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </ActionSheet>
  );
}

/* ---------- Collection editor ---------- */

function CollectionSheet({
  data,
  editing,
  onClose,
}: {
  data: HomeContent;
  editing: Collection | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const mutation = useSaveCollection();
  const [title, setTitle] = useState(editing?.title ?? "");
  const [subtitle, setSubtitle] = useState(editing?.subtitle ?? "");
  const [placement, setPlacement] = useState<Collection["placement"]>(editing?.placement ?? "shelf");
  const [source, setSource] = useState<Collection["source"]>(editing?.source ?? "rules");
  const [rule, setRule] = useState<CollectionRule>(editing?.rule ?? { maxEta: 25 });
  const [ids, setIds] = useState<number[]>(editing?.restaurantIds ?? []);
  const [startsOn, setStartsOn] = useState(editing?.startsOn ?? TODAY);
  const [endsOn, setEndsOn] = useState(editing?.endsOn ?? "");
  const matches = matchRule(rule, data.restaurants);

  return (
    <ActionSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={editing ? `Edit ${editing.title}` : "Create collection"}
      submitLabel={editing ? "Save collection" : "Create collection"}
      pending={mutation.isPending}
      validate={() => {
        if (!title.trim()) return "Give the collection a title customers will see.";
        if (source === "rules" && matches.length < 2)
          return "These rules match fewer than two restaurants. Loosen them.";
        if (source === "handPicked" && ids.length < 2) return "Pick at least two restaurants.";
        if (endsOn && endsOn < startsOn) return "The end date is before the start date.";
        return null;
      }}
      onSubmit={async () => {
        await mutation.mutateAsync({
          id: editing?.id,
          title: title.trim(),
          subtitle: subtitle.trim(),
          placement,
          source,
          rule: source === "rules" ? rule : undefined,
          restaurantIds: source === "handPicked" ? ids : [],
          startsOn,
          endsOn: endsOn || undefined,
          visible: editing?.visible ?? true,
        });
        toast({
          title: editing ? "Collection saved" : "Collection created",
          description:
            startsOn > TODAY
              ? `${title.trim()} goes live ${formatDate(startsOn)}.`
              : `${title.trim()} is on the home feed now.`,
          tone: "success",
        });
      }}
    >
      <TextField
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Rainy evening comfort"
      />
      <TextField
        label="Line underneath (optional)"
        value={subtitle}
        onChange={(e) => setSubtitle(e.target.value)}
        placeholder="Kottu, curry and something sweet"
      />
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>Shown as</legend>
        <Choice
          type="radio"
          name="placement"
          checked={placement === "banner"}
          onChange={() => setPlacement("banner")}
          label="Banner"
          meta="Big photo near the top"
        />
        <Choice
          type="radio"
          name="placement"
          checked={placement === "shelf"}
          onChange={() => setPlacement("shelf")}
          label="Shelf"
          meta="A row of restaurants"
        />
      </fieldset>
      <fieldset className={u.fieldset}>
        <legend className={u.legend}>Restaurants</legend>
        <Choice
          type="radio"
          name="source"
          checked={source === "rules"}
          onChange={() => setSource("rules")}
          label="Follow rules"
          meta="Updates itself"
        />
        <Choice
          type="radio"
          name="source"
          checked={source === "handPicked"}
          onChange={() => setSource("handPicked")}
          label="Hand-picked"
        />
      </fieldset>
      {source === "rules" ? (
        <>
          <div className={u.fieldPair}>
            <Select
              label="Category"
              value={rule.category ?? ""}
              onChange={(e) => setRule({ ...rule, category: e.target.value || undefined })}
              options={[
                { value: "", label: "Any category" },
                ...data.categories.map((c) => ({ value: c.id, label: c.label })),
              ]}
            />
            <Select
              label="Rating"
              value={String(rule.minRating ?? "")}
              onChange={(e) => setRule({ ...rule, minRating: Number(e.target.value) || undefined })}
              options={[
                { value: "", label: "Any rating" },
                { value: "4.5", label: "4.5 and up" },
                { value: "4.7", label: "4.7 and up" },
              ]}
            />
            <Select
              label="Delivery time"
              value={String(rule.maxEta ?? "")}
              onChange={(e) => setRule({ ...rule, maxEta: Number(e.target.value) || undefined })}
              options={[
                { value: "", label: "Any time" },
                { value: "15", label: "15 min or less" },
                { value: "20", label: "20 min or less" },
                { value: "25", label: "25 min or less" },
              ]}
            />
            <label className={cx(u.check, styles.offerCheck)}>
              <input
                type="checkbox"
                checked={!!rule.offersOnly}
                onChange={(e) => setRule({ ...rule, offersOnly: e.target.checked || undefined })}
              />
              Only restaurants with an offer
            </label>
          </div>
          <p className={styles.matchLine} aria-live="polite">
            Matches {matches.length} today
            {matches.length > 0 &&
              `: ${matches
                .slice(0, 5)
                .map((r) => r.name)
                .join(", ")}${matches.length > 5 ? "…" : ""}`}
          </p>
        </>
      ) : (
        <div className={cx(u.checkGrid, styles.pickList)}>
          {data.restaurants.map((r) => (
            <label key={r.id} className={u.check}>
              <input
                type="checkbox"
                checked={ids.includes(r.id)}
                onChange={(e) => setIds(e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id))}
              />
              {r.name}
            </label>
          ))}
        </div>
      )}
      <div className={u.fieldPair}>
        <label>
          <span className={u.label}>Show from</span>
          <input
            type="date"
            className={u.input}
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </label>
        <label>
          <span className={u.label}>Until (optional)</span>
          <input
            type="date"
            className={u.input}
            value={endsOn}
            min={startsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </label>
      </div>
    </ActionSheet>
  );
}

/* ---------- Customer home preview ---------- */

function HomePreview({ data }: { data: HomeContent }) {
  const [day, setDay] = useState(TODAY);
  const cats = data.categories.filter((c) => c.visible);
  const live = data.collections.filter((c) => liveOn(c, day));
  const restaurantsFor = (c: Collection) =>
    (c.source === "rules"
      ? matchRule(c.rule ?? {}, data.restaurants)
      : data.restaurants.filter((r) => c.restaurantIds.includes(r.id))
    ).filter((r) => r.status !== "suspended");

  return (
    <section className={styles.previewWrap} aria-labelledby="preview-title">
      <div className={u.spread}>
        <h2 id="preview-title" className={u.sectionTitle}>
          Customer home
        </h2>
        <Select
          label="Preview date"
          hideLabel
          value={day}
          onChange={(e) => setDay(e.target.value)}
          options={[
            { value: TODAY, label: "Today, 10 Oct" },
            { value: "2026-10-17", label: "Sat 17 Oct" },
            { value: "2026-11-01", label: "Sun 1 Nov" },
          ]}
        />
      </div>
      {/* A sketch of the phone home feed: order and content, not the final styling */}
      <div
        className={styles.phone}
        role="img"
        aria-label={`Preview of the customer home feed for ${formatDate(day)}: ${cats.length} categories, then ${live.map((c) => c.title).join(", ") || "no collections"}.`}
      >
        <div className={styles.searchBand}>Search Kadé</div>
        <div className={styles.catRow}>
          {cats.map((c) => (
            <span key={c.id} className={styles.cat}>
              <img src={imageUrl(c.imageId, 96, 96)} alt="" loading="lazy" />
              {c.label}
            </span>
          ))}
        </div>
        {live
          .filter((c) => c.placement === "banner")
          .map((c) => {
            const first = restaurantsFor(c)[0];
            return (
              <div key={c.id} className={styles.banner}>
                {first && <img src={imageUrl(first.imageId, 480, 200)} alt="" loading="lazy" />}
                <span>
                  <strong>{c.title}</strong>
                  {c.subtitle}
                </span>
              </div>
            );
          })}
        {live
          .filter((c) => c.placement === "shelf")
          .map((c) => (
            <div key={c.id} className={styles.shelf}>
              <strong>{c.title}</strong>
              <div className={styles.shelfRow}>
                {restaurantsFor(c)
                  .slice(0, 6)
                  .map((r) => (
                    <span key={r.id} className={styles.mini}>
                      <img src={imageUrl(r.imageId, 160, 100)} alt="" loading="lazy" />
                      <span className={styles.miniName}>{r.name}</span>
                      <span className={styles.miniMeta}>
                        {r.etaMin}–{r.etaMin + 10} min, ★ {r.rating.toFixed(1)}
                      </span>
                    </span>
                  ))}
              </div>
            </div>
          ))}
        <div className={styles.feedTail}>All restaurants</div>
      </div>
    </section>
  );
}

/* ---------- Page ---------- */

export function ContentPage() {
  useDocumentTitle("Home feed");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "categories";
  const query = useHomeContent();
  const moveCategory = useMoveCategory();
  const updateCategory = useUpdateCategory();
  const moveCollection = useMoveCollection();
  const setVisible = useSetCollectionVisible();
  const [picking, setPicking] = useState<HomeCategory | null>(null);
  const [editing, setEditing] = useState<Collection | "new" | null>(null);
  const data = query.data;

  const categoryColumns: Column<HomeCategory>[] = [
    {
      key: "pos",
      header: "Order",
      width: "64px",
      cell: (c) => <span className={u.num}>{data!.categories.indexOf(c) + 1}</span>,
    },
    {
      key: "label",
      header: "Category",
      cell: (c) => (
        <span className={u.row}>
          <img src={imageUrl(c.imageId, 88, 66)} alt="" className={u.thumb} loading="lazy" />
          <span className={u.strong}>{c.label}</span>
        </span>
      ),
    },
    {
      key: "visible",
      header: "Shown",
      cell: (c) => (
        <Switch
          checked={c.visible}
          hideLabel
          label={`Show ${c.label} on the home feed`}
          onChange={(v) =>
            updateCategory.mutate(
              { id: c.id, visible: v },
              {
                onSuccess: () =>
                  toast({ title: v ? "Category shown" : "Category hidden", description: c.label }),
              },
            )
          }
        />
      ),
    },
    {
      key: "move",
      header: "Move",
      cell: (c) => {
        const i = data!.categories.indexOf(c);
        return (
          <span className={styles.moves}>
            <IconButton
              icon="chevronDown"
              className={styles.up}
              label={`Move ${c.label} up`}
              size="sm"
              variant="soft"
              disabled={i === 0}
              onClick={() => moveCategory.mutate({ id: c.id, direction: -1 })}
            />
            <IconButton
              icon="chevronDown"
              label={`Move ${c.label} down`}
              size="sm"
              variant="soft"
              disabled={i === data!.categories.length - 1}
              onClick={() => moveCategory.mutate({ id: c.id, direction: 1 })}
            />
          </span>
        );
      },
    },
    {
      key: "image",
      header: <span className="kd-visually-hidden">Image</span>,
      cell: (c) => (
        <button
          type="button"
          className={u.textButton}
          onClick={() => setPicking(c)}
          aria-label={`Change image for ${c.label}`}
        >
          Change image
        </button>
      ),
    },
  ];

  const collectionColumns: Column<Collection>[] = [
    {
      key: "title",
      header: "Collection",
      cell: (c) => (
        <span className={u.cellStack}>
          <span className={u.strong}>{c.title}</span>
          <span>{c.subtitle}</span>
        </span>
      ),
    },
    { key: "placement", header: "Shown as", cell: (c) => (c.placement === "banner" ? "Banner" : "Shelf") },
    {
      key: "source",
      header: "Restaurants",
      hideOnNarrow: true,
      cell: (c) =>
        c.source === "rules" ? (
          <span className={u.cellStack}>
            <span>Rules</span>
            <span>{ruleSummary(c.rule, data!.categories)}</span>
          </span>
        ) : (
          <span className={u.cellStack}>
            <span>Hand-picked</span>
            <span>{c.restaurantIds.length} restaurants</span>
          </span>
        ),
    },
    { key: "when", header: "Schedule", cell: schedule },
    {
      key: "visible",
      header: "Shown",
      cell: (c) => (
        <Switch
          checked={c.visible}
          hideLabel
          label={`Show ${c.title}`}
          onChange={(v) =>
            setVisible.mutate(
              { id: c.id, visible: v },
              {
                onSuccess: () =>
                  toast({ title: v ? "Collection shown" : "Collection hidden", description: c.title }),
              },
            )
          }
        />
      ),
    },
    {
      key: "move",
      header: "Move",
      cell: (c) => {
        const i = data!.collections.indexOf(c);
        return (
          <span className={styles.moves}>
            <IconButton
              icon="chevronDown"
              className={styles.up}
              label={`Move ${c.title} up`}
              size="sm"
              variant="soft"
              disabled={i === 0}
              onClick={() => moveCollection.mutate({ id: c.id, direction: -1 })}
            />
            <IconButton
              icon="chevronDown"
              label={`Move ${c.title} down`}
              size="sm"
              variant="soft"
              disabled={i === data!.collections.length - 1}
              onClick={() => moveCollection.mutate({ id: c.id, direction: 1 })}
            />
          </span>
        );
      },
    },
    {
      key: "edit",
      header: <span className="kd-visually-hidden">Edit</span>,
      cell: (c) => (
        <button
          type="button"
          className={u.textButton}
          onClick={() => setEditing(c)}
          aria-label={`Edit ${c.title}`}
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Home feed"
        description="What customers see first when they open Kadé. Changes go live straight away; scheduled collections appear on their start date."
        actions={
          tab === "collections" && (
            <Button icon="plus" onClick={() => setEditing("new")}>
              Create collection
            </Button>
          )
        }
      />
      <QueryState
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        what="home feed content"
      />
      {data && (
        <div className={styles.layout}>
          <Tabs<Tab>
            label="Home feed sections"
            value={tab}
            onChange={(t) => setParams(t === "categories" ? {} : { tab: t }, { replace: true })}
            items={[
              {
                value: "categories",
                label: "Categories",
                count: data.categories.filter((c) => c.visible).length,
              },
              {
                value: "collections",
                label: "Banners and collections",
                count: data.collections.filter((c) => liveOn(c, TODAY)).length,
              },
            ]}
          >
            {tab === "categories" ? (
              <DataTable
                caption="Home feed categories, in the order customers see them"
                columns={categoryColumns}
                rows={data.categories}
                rowKey={(c) => c.id}
              />
            ) : (
              <DataTable
                caption="Banners and collections, in the order customers see them"
                columns={collectionColumns}
                rows={data.collections}
                rowKey={(c) => c.id}
              />
            )}
          </Tabs>
          <HomePreview data={data} />
        </div>
      )}
      {picking && data && (
        <ImageSheet category={picking} images={data.images} onClose={() => setPicking(null)} />
      )}
      {editing && data && (
        <CollectionSheet
          data={data}
          editing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
