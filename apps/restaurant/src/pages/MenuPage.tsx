import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  SearchField,
  Sheet,
  Switch,
  Tag,
  TextField,
  formatRs,
  plural,
  useToast,
} from "@kade/ui";
import { useState } from "react";
import { useAddSection, useMenu, useMoveSection, useSetSoldOut } from "@/api/queries";
import type { Menu, MenuItem } from "@/api/types";
import { ItemSheet, type ItemSheetTarget } from "@/features/menu/ItemSheet";
import { imageUrl } from "@/lib/images";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./MenuPage.module.css";

/** Menu manager: what customers can order, and the quick "sold out today" switch the kitchen lives on. */
export function MenuPage() {
  useDocumentTitle("Menu");
  const { data: menu, isPending, isError, refetch } = useMenu();
  const move = useMoveSection();
  const [query, setQuery] = useState("");
  const [soldOutOnly, setSoldOutOnly] = useState(false);
  const [editing, setEditing] = useState<ItemSheetTarget | null>(null);
  const [addingSection, setAddingSection] = useState(false);

  if (isPending) return <p className={styles.muted}>Loading menu…</p>;
  if (isError)
    return (
      <EmptyState
        title="The menu didn't load"
        description="Check the tablet's connection and try again."
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    );

  const all = menu.sections.flatMap((s) => s.items);
  const soldOutCount = all.filter((i) => i.soldOut).length;
  const q = query.trim().toLowerCase();
  const filtering = !!q || soldOutOnly;
  const matches = (i: MenuItem) =>
    (!q || `${i.name} ${i.description}`.toLowerCase().includes(q)) && (!soldOutOnly || i.soldOut);
  const sections = menu.sections
    .map((s) => ({ ...s, items: s.items.filter(matches) }))
    .filter((s) => !filtering || s.items.length > 0);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Menu</h1>
          <p className={styles.muted}>
            {plural(all.length, "dish", "dishes")} in {plural(menu.sections.length, "section")}. Changes show
            to customers straight away.
          </p>
        </div>
        <div className={styles.headActions}>
          <Button variant="secondary" size="lg" icon="plus" onClick={() => setAddingSection(true)}>
            Add section
          </Button>
          <Button
            size="lg"
            icon="plus"
            onClick={() => setEditing({ sectionId: menu.sections[0]?.id ?? "" })}
            disabled={!menu.sections.length}
          >
            Add dish
          </Button>
        </div>
      </header>

      <div className={styles.tools}>
        <SearchField
          label="Search dishes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.search}
        />
        <Chip pressed={soldOutOnly} onClick={() => setSoldOutOnly((v) => !v)} className={styles.chip}>
          Sold out today, {soldOutCount}
        </Chip>
      </div>

      {sections.length === 0 && (
        <EmptyState
          title={soldOutOnly && !q ? "Nothing is sold out today" : `No dishes match "${query.trim()}"`}
          description={
            soldOutOnly && !q ? "Every dish can be ordered." : "Check the spelling, or add it as a new dish."
          }
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery("");
                setSoldOutOnly(false);
              }}
            >
              Show the whole menu
            </Button>
          }
        />
      )}

      {sections.map((s) => {
        const index = menu.sections.findIndex((x) => x.id === s.id);
        return (
          <section key={s.id} aria-labelledby={`sec-${s.id}`} className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 id={`sec-${s.id}`} className={styles.sectionTitle}>
                {s.name}
                <span className={styles.count}>{s.items.length}</span>
              </h2>
              {!filtering && (
                <div className={styles.sectionActions}>
                  <IconButton
                    icon="chevronDown"
                    className={styles.up}
                    variant="soft"
                    label={`Move ${s.name} up`}
                    disabled={index === 0 || move.isPending}
                    onClick={() => move.mutate({ id: s.id, direction: -1 })}
                  />
                  <IconButton
                    icon="chevronDown"
                    variant="soft"
                    label={`Move ${s.name} down`}
                    disabled={index === menu.sections.length - 1 || move.isPending}
                    onClick={() => move.mutate({ id: s.id, direction: 1 })}
                  />
                  <Button variant="outline" icon="plus" onClick={() => setEditing({ sectionId: s.id })}>
                    Add dish
                  </Button>
                </div>
              )}
            </header>
            {s.items.length ? (
              <ul className={styles.items}>
                {s.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    menu={menu}
                    onEdit={() => setEditing({ item, sectionId: s.id })}
                  />
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                No dishes in this section yet. Customers don't see empty sections.
              </p>
            )}
          </section>
        );
      })}

      {editing && (
        <ItemSheet
          key={editing.item?.id ?? `new-${editing.sectionId}`}
          menu={menu}
          target={editing}
          onClose={() => setEditing(null)}
        />
      )}
      <AddSectionSheet open={addingSection} onOpenChange={setAddingSection} />
    </div>
  );
}

function ItemRow({ item, menu, onEdit }: { item: MenuItem; menu: Menu; onEdit: () => void }) {
  const toast = useToast();
  const setSoldOut = useSetSoldOut();
  const groups = item.optionGroupIds
    .map((id) => menu.optionGroups.find((g) => g.id === id)?.name)
    .filter(Boolean);

  return (
    <li className={styles.item} data-sold-out={item.soldOut || undefined}>
      <div className={styles.thumb}>
        {item.imageId ? (
          <img src={imageUrl(item.imageId, 192, 144)} alt="" loading="lazy" />
        ) : (
          <span>No photo</span>
        )}
      </div>
      <div className={styles.info}>
        <h3 className={styles.name}>
          {item.name}
          {item.tags.map((t) => (
            <Tag key={t} tone={t === "Vegetarian" ? "veg" : "hot"}>
              {t}
            </Tag>
          ))}
        </h3>
        <p className={styles.description}>{item.description}</p>
        {groups.length > 0 && <p className={styles.options}>Options: {groups.join(", ")}</p>}
      </div>
      <p className={styles.price}>{formatRs(item.price)}</p>
      <Switch
        size="lg"
        className={styles.switch}
        label="Sold out today"
        description={item.soldOut ? "Customers can't order it" : undefined}
        checked={item.soldOut}
        onChange={(soldOut) =>
          setSoldOut.mutate(
            { itemId: item.id, soldOut },
            {
              onSuccess: () =>
                toast({
                  title: soldOut ? `${item.name} sold out today` : `${item.name} back on the menu`,
                  description: soldOut ? "It comes back on its own when you open tomorrow." : undefined,
                }),
              onError: (e) => toast({ title: "Not changed", description: e.message, tone: "error" }),
            },
          )
        }
      />
      <Button variant="outline" size="lg" icon="edit" onClick={onEdit} aria-label={`Edit ${item.name}`}>
        Edit
      </Button>
    </li>
  );
}

function AddSectionSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const add = useAddSection();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setName("");
          setError("");
        }
      }}
      title="Add a section"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Name the section, for example Hoppers.");
        add.mutate(name, {
          onSuccess: () => {
            toast({
              title: "Section added",
              description: `${name.trim()} is at the end of your menu.`,
              tone: "success",
            });
            setName("");
            onOpenChange(false);
          },
          onError: (err) => setError(err.message),
        });
      }}
      footer={
        <Button type="submit" size="lg" fullWidth disabled={add.isPending}>
          Add section
        </Button>
      }
    >
      <TextField
        label="Section name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={error || undefined}
        hint="Customers see sections in the order you set here."
        className={styles.sectionField}
      />
    </Sheet>
  );
}
