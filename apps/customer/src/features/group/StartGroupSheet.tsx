import { Button, SegmentedControl, Sheet, TextField } from "@kade/ui";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useCreateGroup } from "@/api/queries";
import type { Restaurant } from "@/api/types";
import { useSession } from "@/features/account/session";
import styles from "./StartGroupSheet.module.css";

const closeOptions = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
];

const limitOptions = [
  { value: "none", label: "No limit" },
  { value: "1500", label: "Rs 1,500" },
  { value: "2500", label: "Rs 2,500" },
  { value: "4000", label: "Rs 4,000" },
];

export interface StartGroupSheetProps {
  restaurant: Restaurant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function GroupForm({ restaurant, onOpenChange }: Omit<StartGroupSheetProps, "open">) {
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const create = useCreateGroup();
  const [minutes, setMinutes] = useState("30");
  const [limit, setLimit] = useState("none");
  const [name, setName] = useState(user?.name ?? "");
  const [error, setError] = useState<string | undefined>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Add your name so everyone knows whose group it is.");
      return;
    }
    try {
      const group = await create.mutateAsync({
        restaurantId: restaurant.id,
        hostName: name,
        minutes: Number(minutes),
        limit: limit === "none" ? undefined : Number(limit),
      });
      onOpenChange(false);
      navigate(`/group/${group.id}`);
    } catch {
      setError("The group wasn't created. Check your connection and try again.");
    }
  };

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title="Start a group order"
      onSubmit={submit}
      footer={
        <Button type="submit" size="lg" fullWidth disabled={create.isPending}>
          {create.isPending ? "Creating group…" : "Create group and get the link"}
        </Button>
      }
    >
      <p className={styles.lead}>
        Everyone adds their own dishes from {restaurant.name} using one link. You see what each person picked,
        then place a single order and pay for it.
      </p>
      <div className={styles.fields}>
        <TextField
          label="Your name"
          autoComplete="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
          error={error}
        />
        <div>
          <p className={styles.label}>Orders close in</p>
          <SegmentedControl
            label="Orders close in"
            options={closeOptions}
            value={minutes}
            onChange={setMinutes}
          />
        </div>
        <div>
          <p className={styles.label}>Spending limit per person</p>
          <div className={styles.scroll}>
            <SegmentedControl
              label="Spending limit per person"
              options={limitOptions}
              value={limit}
              onChange={setLimit}
            />
          </div>
          <p className={styles.hint}>Optional. People can still add more; you'll see who's over.</p>
        </div>
      </div>
    </Sheet>
  );
}

/** Mounted only while open, so the form starts fresh each time. */
export function StartGroupSheet({ open, ...rest }: StartGroupSheetProps) {
  return open ? <GroupForm {...rest} /> : null;
}
