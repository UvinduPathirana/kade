import { Button, Choice, ChoiceGroup, Sheet, Stepper, TextArea, formatRs } from "@kade/ui";
import { useRef, useState, type FormEvent } from "react";
import type { MenuItem, OptionGroup } from "@/api/types";
import type { NewLine } from "@/features/cart/store";
import { imageUrl } from "@/lib/images";
import { unitPriceFor, type Selection } from "./pricing";
import { useReducedMotion } from "@/lib/useReducedMotion";
import styles from "./ItemOptionsSheet.module.css";

export type AddResult = "added" | "conflict";

export interface ItemOptionsSheetProps {
  item: MenuItem | null;
  optionGroups: Record<string, OptionGroup>;
  onClose: () => void;
  /** Try to add the configured line. "conflict" means the cart holds another restaurant's dishes. */
  onAdd: (line: NewLine) => AddResult;
}

const groupHint = (g: OptionGroup) =>
  g.required ? "Required" : g.max > 1 ? `Optional, up to ${g.max}` : "Optional";

function SheetContent({ item, optionGroups, onClose, onAdd }: ItemOptionsSheetProps & { item: MenuItem }) {
  const reduceMotion = useReducedMotion();
  const [qty, setQty] = useState(1);
  const [sel, setSel] = useState<Selection>({});
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState(false);
  const groupRefs = useRef<Record<string, HTMLFieldSetElement | null>>({});

  const groups = item.optionGroupIds.map((id) => optionGroups[id]).filter((g): g is OptionGroup => !!g);
  const unit = unitPriceFor(item, optionGroups, sel);

  const choose = (g: OptionGroup, index: number, checked: boolean) => {
    setSel((prev) => {
      const current = prev[g.id] ?? [];
      const next = g.max === 1 ? [index] : checked ? [...current, index] : current.filter((i) => i !== index);
      return { ...prev, [g.id]: next };
    });
    if (checked)
      setErrors((prev) => {
        const next = new Set(prev);
        next.delete(g.id);
        return next;
      });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (added) return;
    const missing = groups.filter((g) => g.required && !sel[g.id]?.length).map((g) => g.id);
    if (missing.length) {
      setErrors(new Set(missing));
      const first = groupRefs.current[missing[0]!];
      first?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      first?.querySelector("input")?.focus({ preventScroll: true });
      return;
    }
    const choices = groups.flatMap((g) => (sel[g.id] ?? []).map((i) => g.choices[i]!.name));
    const result = onAdd({
      itemId: item.id,
      name: item.name,
      unitPrice: unit,
      qty,
      choices,
      note: note.trim(),
    });
    if (result === "added") {
      setAdded(true);
      window.setTimeout(onClose, reduceMotion ? 0 : 550);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={item.name}
      onSubmit={submit}
      media={item.imageId ? <img src={imageUrl(item.imageId, 1120, 630)} alt="" /> : undefined}
      footer={
        <>
          <Stepper value={qty} onChange={setQty} min={1} max={20} size="md" label="Quantity" />
          {added ? (
            <Button type="submit" size="lg" className={styles.added} icon="check">
              Added to order
            </Button>
          ) : (
            <Button
              type="submit"
              variant="turmeric"
              size="lg"
              className={styles.add}
              trailing={formatRs(unit * qty)}
            >
              Add {qty} to order
            </Button>
          )}
        </>
      }
    >
      {item.description && <p className={styles.desc}>{item.description}</p>}
      <p className={styles.price}>{formatRs(item.price)}</p>

      {groups.map((g) => {
        const chosen = sel[g.id] ?? [];
        const full = g.max > 1 && chosen.length >= g.max;
        return (
          <ChoiceGroup
            key={g.id}
            ref={(el) => {
              groupRefs.current[g.id] = el;
            }}
            legend={g.name}
            hint={groupHint(g)}
            required={g.required}
            complete={chosen.length > 0}
            error={errors.has(g.id) ? `Choose ${g.name.toLowerCase()} to continue.` : undefined}
          >
            {g.choices.map((c, i) => (
              <Choice
                key={c.name}
                type={g.max === 1 ? "radio" : "checkbox"}
                name={`${item.id}-${g.id}`}
                label={c.name}
                meta={c.price ? `+ ${formatRs(c.price)}` : undefined}
                checked={chosen.includes(i)}
                disabled={full && !chosen.includes(i)}
                onChange={(e) => choose(g, i, e.target.checked)}
              />
            ))}
          </ChoiceGroup>
        );
      })}

      <TextArea
        label="Note for the kitchen"
        name="note"
        maxLength={140}
        placeholder="For example: no onions, gravy on the side"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <span className="kd-visually-hidden" aria-live="polite">
        {added ? `${item.name} added to your order` : ""}
      </span>
    </Sheet>
  );
}

/** Item options: centred dialog on desktop, bottom sheet on phones. */
export function ItemOptionsSheet(props: ItemOptionsSheetProps) {
  if (!props.item) return null;
  // Keyed by item so every dish opens with fresh choices
  return <SheetContent key={props.item.id} {...props} item={props.item} />;
}
