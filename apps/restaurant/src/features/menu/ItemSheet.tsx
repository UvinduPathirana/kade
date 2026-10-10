import {
  Button,
  Choice,
  ChoiceGroup,
  ConfirmDialog,
  Select,
  Sheet,
  TextArea,
  TextField,
  formatRs,
  useToast,
} from "@kade/ui";
import { useState, type FormEvent } from "react";
import { useDeleteItem, useSaveItem } from "@/api/queries";
import type { DishTag, Menu, MenuItem } from "@/api/types";
import { imageUrl, resizePhoto } from "@/lib/images";
import styles from "./ItemSheet.module.css";

export interface ItemSheetTarget {
  /** Undefined when adding a new dish. */
  item?: MenuItem;
  sectionId: string;
}

const TAGS: DishTag[] = ["Vegetarian", "Spicy"];

/**
 * Add or edit a dish: what customers read, the price, the photo, which options they choose from.
 * Rendered with a key per dish, so the form starts fresh each time it opens.
 */
export function ItemSheet({
  menu,
  target,
  onClose,
}: {
  menu: Menu;
  target: ItemSheetTarget;
  onClose: () => void;
}) {
  const toast = useToast();
  const save = useSaveItem();
  const remove = useDeleteItem();
  const { item } = target;
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [sectionId, setSectionId] = useState(target.sectionId);
  const [tags, setTags] = useState<DishTag[]>(item?.tags ?? []);
  const [groupIds, setGroupIds] = useState<string[]>(item?.optionGroupIds ?? []);
  const [photo, setPhoto] = useState<string | undefined>(item?.imageId);
  const [photoError, setPhotoError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const priceNumber = Number(price.replace(/[^\d]/g, ""));
  const nameError = submitted && !name.trim() ? "Give the dish a name customers will recognise." : undefined;
  const priceError =
    submitted && !(priceNumber > 0) ? "Enter the price in rupees, for example 1150." : undefined;

  const toggle = <T,>(list: T[], value: T, on: boolean) =>
    on ? [...list, value] : list.filter((x) => x !== value);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError("");
    try {
      setPhoto(await resizePhoto(file));
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!name.trim() || !(priceNumber > 0)) return;
    save.mutate(
      {
        id: item?.id,
        sectionId,
        name: name.trim(),
        description: description.trim(),
        price: priceNumber,
        imageId: photo,
        tags,
        optionGroupIds: groupIds,
      },
      {
        onSuccess: () => {
          toast({ title: item ? "Dish saved" : "Dish added", description: name.trim(), tone: "success" });
          onClose();
        },
        onError: (err) => toast({ title: "Dish not saved", description: err.message, tone: "error" }),
      },
    );
  };

  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => !open && onClose()}
        title={item ? `Edit ${item.name}` : "Add a dish"}
        onSubmit={onSubmit}
        footer={
          <div className={styles.foot}>
            {item && (
              <Button variant="outline" size="lg" icon="trash" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <span className={styles.spacer} />
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending}>
              {item ? "Save dish" : "Add dish"}
            </Button>
          </div>
        }
      >
        <div className={styles.body}>
          <div className={styles.photoRow}>
            <div className={styles.photo}>
              {photo ? (
                <img src={imageUrl(photo, 480, 360)} alt={`Photo of ${name || "the dish"}`} />
              ) : (
                <span>No photo yet. Dishes with photos sell more.</span>
              )}
            </div>
            <div className={styles.photoActions}>
              <label className={styles.upload}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => void onPhoto(e.target.files?.[0])}
                />
                <span>{photo ? "Replace photo" : "Upload photo"}</span>
              </label>
              {photo && (
                <Button variant="outline" onClick={() => setPhoto(undefined)}>
                  Remove photo
                </Button>
              )}
              <p className={styles.hint}>JPG or PNG, landscape, the dish filling the frame.</p>
              {photoError && (
                <p className={styles.error} role="alert">
                  {photoError}
                </p>
              )}
            </div>
          </div>

          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
            maxLength={60}
            required
          />
          <TextArea
            label="Description"
            rows={3}
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's in it and how it's cooked"
          />
          <div className={styles.pair}>
            <TextField
              label="Price"
              prefix="Rs"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              error={priceError}
              hint={priceNumber > 0 ? `Customers see ${formatRs(priceNumber)}` : undefined}
              required
            />
            <Select
              label="Section"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              options={menu.sections.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>

          <ChoiceGroup legend="Labels" hint="Optional">
            {TAGS.map((t) => (
              <Choice
                key={t}
                type="checkbox"
                label={t}
                checked={tags.includes(t)}
                onChange={(e) => setTags(toggle(tags, t, e.target.checked))}
              />
            ))}
          </ChoiceGroup>

          <ChoiceGroup legend="Options customers choose" hint="Optional">
            {menu.optionGroups.map((g) => (
              <Choice
                key={g.id}
                type="checkbox"
                label={
                  <span className={styles.group}>
                    <strong>{g.name}</strong>
                    <small>
                      {g.required ? "Required, pick 1" : `Optional, up to ${g.max}`}:{" "}
                      {g.choices
                        .map((c) => (c.price ? `${c.name} +${formatRs(c.price)}` : c.name))
                        .join(", ")}
                    </small>
                  </span>
                }
                checked={groupIds.includes(g.id)}
                onChange={(e) => setGroupIds(toggle(groupIds, g.id, e.target.checked))}
              />
            ))}
          </ChoiceGroup>
        </div>
      </Sheet>

      {item && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${item.name}?`}
          description="It comes off the menu for good. To stop orders just for today, use Sold out today instead."
          cancelLabel="Keep dish"
          confirmLabel="Delete dish"
          onConfirm={() =>
            remove.mutate(item.id, {
              onSuccess: () => {
                toast({ title: "Dish deleted", description: item.name, tone: "success" });
                onClose();
              },
              onError: (err) => toast({ title: "Dish not deleted", description: err.message, tone: "error" }),
            })
          }
        />
      )}
    </>
  );
}
