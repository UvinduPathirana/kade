// The partner application in progress, saved on this device so a half-finished sign-up survives a
// reload. Only file names are kept; the onboarding service receives the files on submit.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PartnerApplication } from "@/api/types";

export const emptyApplication: PartnerApplication = {
  business: { name: "", type: "restaurant", address: "", city: "", brNumber: "" },
  owner: { name: "", phone: "", email: "", nic: "" },
  documents: { registration: "", foodSafety: "", ownerId: "" },
  bank: { bank: "", branch: "", accountName: "", accountNumber: "" },
  menu: { method: "file", fileName: "" },
};

interface DraftState {
  step: number;
  app: PartnerApplication;
  setStep: (step: number) => void;
  update: <K extends keyof PartnerApplication>(part: K, values: Partial<PartnerApplication[K]>) => void;
  reset: () => void;
}

export const useDraft = create<DraftState>()(
  persist(
    (set) => ({
      step: 0,
      app: emptyApplication,
      setStep: (step) => set({ step }),
      update: (part, values) => set((s) => ({ app: { ...s.app, [part]: { ...s.app[part], ...values } } })),
      reset: () => set({ step: 0, app: emptyApplication }),
    }),
    { name: "kade.partner.join.v1" },
  ),
);

export const steps = ["Business", "Owner", "Documents", "Bank account", "Menu", "Review and submit"] as const;

export const businessTypes = [
  { value: "restaurant", label: "Restaurant" },
  { value: "cafe", label: "Café or bakery café" },
  { value: "bakery", label: "Bakery or short eats" },
  { value: "homeKitchen", label: "Home kitchen" },
  { value: "cloudKitchen", label: "Delivery-only kitchen" },
];

export const banks = [
  "Bank of Ceylon",
  "People's Bank",
  "Commercial Bank of Ceylon",
  "Hatton National Bank",
  "Sampath Bank",
  "Seylan Bank",
  "Nations Trust Bank",
  "DFCC Bank",
  "National Development Bank",
  "Pan Asia Bank",
  "Union Bank of Colombo",
  "Amana Bank",
  "Cargills Bank",
  "National Savings Bank",
  "HSBC Sri Lanka",
  "Standard Chartered Sri Lanka",
];

type Errors = Record<string, string>;

/** Checks one step. Returns field → message for anything that needs fixing. */
export function validate(step: number, app: PartnerApplication): Errors {
  const e: Errors = {};
  const { business: b, owner: o, documents: d, bank: k, menu: m } = app;
  if (step === 0) {
    if (!b.name.trim()) e.name = "Enter the name customers know you by.";
    if (!b.address.trim()) e.address = "Enter the street address riders come to.";
    if (!b.city.trim()) e.city = "Enter the area, for example Kollupitiya, Colombo 03.";
    if (!/^[A-Za-z]{1,4}[\s/-]?\d{3,8}$/.test(b.brNumber.trim()))
      e.brNumber = "Enter the number from your certificate, for example PV 00123456.";
  }
  if (step === 1) {
    if (!o.name.trim()) e.name = "Enter the owner's full name.";
    const digits = o.phone.replace(/\D/g, "").replace(/^94/, "").replace(/^0/, "");
    if (!/^7\d{8}$/.test(digits)) e.phone = "Enter a Sri Lankan mobile number, for example 77 123 4567.";
    if (!/^\S+@\S+\.\S+$/.test(o.email.trim())) e.email = "Enter an email address for statements.";
    if (!/^(\d{9}[VvXx]|\d{12})$/.test(o.nic.trim()))
      e.nic = "Enter the NIC number: 9 digits and V, or 12 digits.";
  }
  if (step === 2) {
    if (!d.registration) e.registration = "Upload your business registration certificate.";
    if (!d.foodSafety) e.foodSafety = "Upload your food safety or health certificate.";
    if (!d.ownerId) e.ownerId = "Upload the owner's NIC or passport.";
  }
  if (step === 3) {
    if (!k.bank) e.bank = "Choose your bank.";
    if (!k.branch.trim()) e.branch = "Enter the branch, for example Kollupitiya.";
    if (!k.accountName.trim()) e.accountName = "Enter the name on the account.";
    if (!/^\d{8,16}$/.test(k.accountNumber.replace(/\s/g, "")))
      e.accountNumber = "Enter the account number, 8 to 16 digits.";
  }
  if (step === 4 && m.method !== "later" && !m.fileName)
    e.fileName =
      m.method === "file" ? "Upload your menu, or choose another option." : "Upload a photo of your menu.";
  return e;
}
