import {
  Button,
  Icon,
  SearchField,
  SegmentedControl,
  Sheet,
  TextArea,
  TextField,
  cx,
  useToast,
} from "@kade/ui";
import { useState, type FormEvent } from "react";
import { DELIVERY_ZONE, joinWaitlist, newAddressId } from "@/api/addresses";
import { useAddresses, usePlaces, useSaveAddress } from "@/api/queries";
import type { Place, SavedAddress } from "@/api/types";
import { PinMap } from "./PinMap";
import { describePin } from "./geo";
import { useAddress } from "./store";
import styles from "./AddressPicker.module.css";

type View = { kind: "find" } | { kind: "pin"; place: Place | null } | { kind: "outside"; place: Place };

type LabelChoice = "Home" | "Work" | "Other";

const labelOptions: { value: LabelChoice; label: string }[] = [
  { value: "Home", label: "Home" },
  { value: "Work", label: "Work" },
  { value: "Other", label: "Other" },
];

const titles: Record<View["kind"], string> = {
  find: "Where should we deliver?",
  pin: "Put the pin on your gate",
  outside: "Not delivering there yet",
};

/** One flow for choosing, adding and pinning an address. Opened from the header and from checkout. */
function PickerSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const current = useAddress((s) => s.current);
  const setCurrent = useAddress((s) => s.setCurrent);
  const { data: saved = [] } = useAddresses();
  const save = useSaveAddress();

  const [view, setView] = useState<View>({ kind: "find" });
  const [query, setQuery] = useState("");
  const { data: places = [], isFetching } = usePlaces(query);
  const searching = query.trim().length >= 2;

  const [center, setCenter] = useState(current.pin ?? { x: 352, y: 500 });
  const [label, setLabel] = useState<LabelChoice>("Home");
  const [customLabel, setCustomLabel] = useState("");
  const [street, setStreet] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ street?: string; label?: string; pin?: string }>({});
  const [waitlisted, setWaitlisted] = useState(false);

  const spot = describePin(center);

  const choose = (address: SavedAddress) => {
    setCurrent(address);
    toast({ title: `Delivering to ${address.label}`, description: address.line, tone: "success" });
    onClose();
  };

  const pickPlace = (place: Place) => {
    if (!place.inZone) {
      setView({ kind: "outside", place });
      setWaitlisted(false);
      return;
    }
    setCenter(place.pin!);
    setStreet("");
    setErrors({});
    setView({ kind: "pin", place });
  };

  const dropPin = () => {
    setStreet("");
    setErrors({});
    setView({ kind: "pin", place: null });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (view.kind !== "pin") return;
    const next: typeof errors = {};
    if (!spot.ok) next.pin = spot.reason;
    // A dropped pin has no building name, so the rider needs a street address
    if (!view.place && !street.trim())
      next.street = "Add a house number and street so the rider can find you.";
    if (label === "Other" && !customLabel.trim()) next.label = "Name this address, like Amma's place or Gym.";
    setErrors(next);
    if (Object.keys(next).length || !spot.ok) return;

    const name = label === "Other" ? customLabel.trim() : label;
    const district = view.place ? view.place.detail.split(", ").pop()! : spot.district;
    const placeName = view.place
      ? view.place.name
      : spot.label.toLowerCase().startsWith("near")
        ? ""
        : spot.label;
    const address: SavedAddress = {
      id: label === "Other" ? newAddressId() : label.toLowerCase(),
      label: name,
      line: [street.trim(), placeName, district].filter(Boolean).join(", "),
      area: view.place?.area ?? spot.area,
      note: note.trim() || undefined,
      pin: center,
    };
    await save.mutateAsync(address);
    setCurrent(address);
    toast({
      title: "Address saved",
      description: `Delivering to ${address.label}, ${address.line}`,
      tone: "success",
    });
    onClose();
  };

  const replaces = label !== "Other" && saved.some((a) => a.id === label.toLowerCase());

  const footer =
    view.kind === "pin" ? (
      <Button type="submit" size="lg" fullWidth disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save address"}
      </Button>
    ) : view.kind === "outside" && !waitlisted ? (
      <Button
        size="lg"
        fullWidth
        onClick={async () => {
          await joinWaitlist(view.place);
          setWaitlisted(true);
        }}
      >
        Save {view.place.name} for later
      </Button>
    ) : undefined;

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={titles[view.kind]}
      closeLabel="Close address picker"
      footer={footer}
      onSubmit={view.kind === "pin" ? submit : undefined}
    >
      {view.kind === "find" && (
        <div className={styles.body}>
          <SearchField
            label="Search for a street, building or area"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className={styles.search}
          />

          {searching ? (
            <>
              <p className="kd-visually-hidden" aria-live="polite">
                {isFetching ? "" : `${places.length} ${places.length === 1 ? "place" : "places"} found`}
              </p>
              {places.length ? (
                <ul className={styles.list}>
                  {places.map((p) => (
                    <li key={p.id}>
                      <button type="button" className={styles.row} onClick={() => pickPlace(p)}>
                        <Icon name={p.inZone ? "pin" : "globe"} />
                        <span>
                          <strong>{p.name}</strong>
                          <span>{p.inZone ? p.detail : `${p.detail}, outside our delivery area`}</span>
                        </span>
                        <Icon name="chevronRight" size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                !isFetching && (
                  <p className={styles.none}>
                    No places match "{query.trim()}". Try a street, building or area, like Liberty Plaza or
                    Wellawatte, or drop a pin on the map.
                  </p>
                )
              )}
            </>
          ) : (
            <section aria-labelledby="saved-title">
              <h3 id="saved-title" className={styles.heading}>
                Saved addresses
              </h3>
              <ul className={styles.list}>
                {saved.map((a) => {
                  const selected = a.id === current.id && a.line === current.line;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        className={cx(styles.row, selected && styles.selected)}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => choose(a)}
                      >
                        <Icon name={a.id === "home" ? "home" : a.id === "work" ? "store" : "pin"} />
                        <span>
                          <strong>{a.label}</strong>
                          <span>{a.line}</span>
                        </span>
                        {selected && <Icon name="check" size={18} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <Button variant="outline" icon="map" onClick={dropPin} className={styles.drop}>
            Drop a pin on the map
          </Button>
          <p className={styles.zone}>Kadé delivers in {DELIVERY_ZONE}.</p>
        </div>
      )}

      {view.kind === "pin" && (
        <div className={styles.body}>
          <div className={styles.placeHead}>
            <span>
              <strong>{view.place?.name ?? (spot.ok ? spot.label : "Dropped pin")}</strong>
              <span>
                {view.place?.detail ??
                  (spot.ok ? `${spot.area}, ${spot.district}` : "Move the map to place it")}
              </span>
            </span>
            <Button variant="secondary" size="sm" onClick={() => setView({ kind: "find" })}>
              Search again
            </Button>
          </div>
          <PinMap
            center={center}
            onChange={(c) => {
              setCenter(c);
              if (errors.pin) setErrors((x) => ({ ...x, pin: undefined }));
            }}
            description={
              spot.ok
                ? `Pin ${spot.label.startsWith("Near") ? "near" : "at"} ${spot.label.replace(/^Near /, "")}, ${spot.area}`
                : spot.reason
            }
            invalid={!spot.ok}
          />
          <div className={styles.fields}>
            <TextField
              label={view.place ? "House, flat or floor" : "House number and street"}
              hint={view.place ? "Optional" : undefined}
              placeholder={view.place ? "Flat 4B, 2nd floor" : "No. 12, Charles Drive"}
              value={street}
              onChange={(e) => {
                setStreet(e.target.value);
                if (errors.street) setErrors((x) => ({ ...x, street: undefined }));
              }}
              error={errors.street}
              autoComplete="address-line1"
            />
            <div>
              <SegmentedControl label="Save as" options={labelOptions} value={label} onChange={setLabel} />
              {replaces && <p className={styles.replaces}>This replaces your saved {label} address.</p>}
            </div>
            {label === "Other" && (
              <TextField
                label="Name this address"
                placeholder="Amma's place"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                error={errors.label}
                maxLength={30}
              />
            )}
            <TextArea
              label="Note for the rider"
              maxLength={160}
              placeholder="Blue gate opposite the temple, ring twice"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={styles.note}
            />
          </div>
        </div>
      )}

      {view.kind === "outside" && (
        <div className={styles.body} aria-live="polite">
          <p className={styles.outsideText}>
            {view.place.name} is outside where riders can reach for now. Kadé delivers in {DELIVERY_ZONE}.
          </p>
          {waitlisted ? (
            <p className={styles.done}>
              <Icon name="check" />
              Saved. We'll let you know when Kadé starts delivering in {view.place.name}.
            </p>
          ) : (
            <p className={styles.outsideText}>
              Save {view.place.name} and we'll tell you as soon as we start delivering there.
            </p>
          )}
          <Button variant="secondary" onClick={() => setView({ kind: "find" })}>
            Search for another address
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** Mounted once in the root layout; the header and checkout open it through the address store. */
export function AddressPicker() {
  const open = useAddress((s) => s.pickerOpen);
  const setOpen = useAddress((s) => s.setPickerOpen);
  return open ? <PickerSheet onClose={() => setOpen(false)} /> : null;
}
