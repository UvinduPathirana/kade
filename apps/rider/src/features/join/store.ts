import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DocKey } from "@/api/onboarding";
import type { VehicleType } from "@/api/types";

/** The sign-up form, saved as the rider goes so a dropped connection or a closed tab loses nothing. */
export interface JoinForm {
  name: string;
  nic: string;
  phone: string;
  city: string;
  vehicle?: VehicleType;
  documents: Partial<Record<DocKey, string>>;
  bank: { bank: string; branch: string; account: string; holder: string };
  lessons: string[];
}

interface JoinState extends JoinForm {
  step: number;
  set: (patch: Partial<JoinForm>) => void;
  setStep: (step: number) => void;
  reset: () => void;
}

const empty: JoinForm & { step: number } = {
  step: 0,
  name: "",
  nic: "",
  phone: "",
  city: "",
  vehicle: undefined,
  documents: {},
  bank: { bank: "", branch: "", account: "", holder: "" },
  lessons: [],
};

export const useJoin = create<JoinState>()(
  persist(
    (set) => ({
      ...empty,
      set: (patch) => set(patch),
      setStep: (step) => set({ step }),
      reset: () => set(empty),
    }),
    { name: "kade.rider.join.v1", storage: createJSONStorage(() => localStorage) },
  ),
);

export const VEHICLES: {
  value: VehicleType;
  label: string;
  icon: "bike" | "car";
  needs: string;
  note: string;
}[] = [
  {
    value: "motorbike",
    label: "Motorbike",
    icon: "bike",
    needs: "Driving licence with category A or A1, revenue licence and insurance",
    note: "Most jobs, all of Colombo",
  },
  {
    value: "tukTuk",
    label: "Tuk-tuk",
    icon: "car",
    needs: "Driving licence with category B1, revenue licence and insurance",
    note: "Bigger orders and grocery runs",
  },
  {
    value: "bicycle",
    label: "Bicycle",
    icon: "bike",
    needs: "Just your NIC",
    note: "Short trips, up to 3 km",
  },
];

export const DOCS: { key: DocKey; name: string; hint: string; motorOnly: boolean }[] = [
  {
    key: "licence",
    name: "Driving licence",
    hint: "Front side, all four corners in the photo",
    motorOnly: true,
  },
  {
    key: "revenue",
    name: "Revenue licence",
    hint: "The current one, with the expiry date readable",
    motorOnly: true,
  },
  { key: "insurance", name: "Insurance certificate", hint: "Must show your vehicle number", motorOnly: true },
  { key: "nicFront", name: "NIC (front)", hint: "Your photo and number clear, no glare", motorOnly: false },
  { key: "nicBack", name: "NIC (back)", hint: "Address readable", motorOnly: false },
];

export const docsFor = (vehicle?: VehicleType) => DOCS.filter((d) => vehicle !== "bicycle" || !d.motorOnly);

export const LESSONS = [
  {
    id: "food",
    title: "Food safety",
    minutes: 3,
    points: [
      "Keep hot and cold food apart in your bag, and the bag closed between stops.",
      "Never open a sealed bag. If a seal is broken at pickup, tell the restaurant before you leave.",
      "Keep drinks upright in the cup holder. Wipe the bag out at the end of each day.",
    ],
  },
  {
    id: "cash",
    title: "Cash handling",
    minutes: 2,
    points: [
      "Start each shift with Rs 2,000 in small notes for change.",
      "Count cash in front of the customer and say the change out loud.",
      "Deposit before you go over your Rs 15,000 limit. Above it you'll only get card orders.",
    ],
  },
  {
    id: "road",
    title: "Road safety",
    minutes: 4,
    points: [
      "Helmet strapped on every trip, and lights on after 6 pm.",
      "Mount your phone. Don't hold it while riding; the app reads out new jobs.",
      "No order is worth a risk. If you're running late, the customer is told, not hurried.",
    ],
  },
] as const;

export const CITIES = [
  "Colombo 01–04",
  "Colombo 05–07",
  "Colombo 08–10",
  "Colombo 11–15",
  "Dehiwala-Mount Lavinia",
  "Nugegoda",
  "Rajagiriya",
  "Battaramulla",
  "Wattala",
];

export const BANKS = [
  "Commercial Bank",
  "Bank of Ceylon",
  "People's Bank",
  "Sampath Bank",
  "Hatton National Bank",
  "National Savings Bank",
  "Seylan Bank",
];
