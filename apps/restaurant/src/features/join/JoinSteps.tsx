import { Choice, ChoiceGroup, Select, TextField } from "@kade/ui";
import type { BusinessType } from "@/api/types";
import { banks, businessTypes, steps, useDraft } from "./draft";
import { FileField } from "./FileField";
import styles from "./JoinSteps.module.css";

type Errors = Record<string, string | undefined>;

export function BusinessStep({ errors }: { errors: Errors }) {
  const b = useDraft((s) => s.app.business);
  const update = useDraft((s) => s.update);
  return (
    <div className={styles.fields}>
      <TextField
        label="Business name"
        value={b.name}
        onChange={(e) => update("business", { name: e.target.value })}
        error={errors.name}
        autoComplete="organization"
        hint="As customers will see it on Kadé"
      />
      <Select
        label="Type of business"
        value={b.type}
        onChange={(e) => update("business", { type: e.target.value as BusinessType })}
        options={businessTypes}
      />
      <TextField
        label="Street address"
        value={b.address}
        onChange={(e) => update("business", { address: e.target.value })}
        error={errors.address}
        autoComplete="street-address"
        placeholder="312 Galle Road"
      />
      <TextField
        label="Area and city"
        value={b.city}
        onChange={(e) => update("business", { city: e.target.value })}
        error={errors.city}
        placeholder="Kollupitiya, Colombo 03"
      />
      <TextField
        label="Business registration number"
        value={b.brNumber}
        onChange={(e) => update("business", { brNumber: e.target.value })}
        error={errors.brNumber}
        hint="From your BR certificate, for example PV 00123456 or WCO/12345"
      />
    </div>
  );
}

export function OwnerStep({ errors }: { errors: Errors }) {
  const o = useDraft((s) => s.app.owner);
  const update = useDraft((s) => s.update);
  return (
    <div className={styles.fields}>
      <TextField
        label="Owner's full name"
        value={o.name}
        onChange={(e) => update("owner", { name: e.target.value })}
        error={errors.name}
        autoComplete="name"
      />
      <TextField
        label="Mobile number"
        type="tel"
        prefix="+94"
        inputMode="tel"
        placeholder="77 123 4567"
        value={o.phone}
        onChange={(e) => update("owner", { phone: e.target.value })}
        error={errors.phone}
        hint="We text updates about your application here"
        autoComplete="tel-national"
      />
      <TextField
        label="Email"
        type="email"
        value={o.email}
        onChange={(e) => update("owner", { email: e.target.value })}
        error={errors.email}
        autoComplete="email"
        hint="Weekly statements go here"
      />
      <TextField
        label="NIC number"
        value={o.nic}
        onChange={(e) => update("owner", { nic: e.target.value })}
        error={errors.nic}
        hint="9 digits and V, or the new 12-digit number"
      />
    </div>
  );
}

export function DocumentsStep({ errors }: { errors: Errors }) {
  const d = useDraft((s) => s.app.documents);
  const update = useDraft((s) => s.update);
  return (
    <div className={styles.fields}>
      <p className={styles.lead}>
        PDF or a clear photo of each, up to 10 MB. We only use them to check your business.
      </p>
      <FileField
        label="Business registration certificate"
        hint="From the Divisional Secretariat or Registrar of Companies"
        value={d.registration}
        onChange={(registration) => update("documents", { registration })}
        error={errors.registration}
      />
      <FileField
        label="Food safety certificate"
        hint="Health certificate from your Municipal Council or PHI"
        value={d.foodSafety}
        onChange={(foodSafety) => update("documents", { foodSafety })}
        error={errors.foodSafety}
      />
      <FileField
        label="Owner's NIC or passport"
        hint="Both sides of the NIC, or the photo page of the passport"
        value={d.ownerId}
        onChange={(ownerId) => update("documents", { ownerId })}
        error={errors.ownerId}
      />
    </div>
  );
}

export function BankStep({ errors }: { errors: Errors }) {
  const k = useDraft((s) => s.app.bank);
  const update = useDraft((s) => s.update);
  return (
    <div className={styles.fields}>
      <p className={styles.lead}>
        Payouts go here every Tuesday for the week before. The account must be in the business or owner's
        name.
      </p>
      <div>
        <Select
          label="Bank"
          value={k.bank}
          onChange={(e) => update("bank", { bank: e.target.value })}
          options={[{ value: "", label: "Choose your bank" }, ...banks.map((b) => ({ value: b, label: b }))]}
          aria-invalid={errors.bank ? true : undefined}
        />
        {errors.bank && (
          <p className={styles.error} role="alert">
            {errors.bank}
          </p>
        )}
      </div>
      <TextField
        label="Branch"
        value={k.branch}
        onChange={(e) => update("bank", { branch: e.target.value })}
        error={errors.branch}
        placeholder="Kollupitiya"
      />
      <TextField
        label="Name on the account"
        value={k.accountName}
        onChange={(e) => update("bank", { accountName: e.target.value })}
        error={errors.accountName}
      />
      <TextField
        label="Account number"
        inputMode="numeric"
        value={k.accountNumber}
        onChange={(e) => update("bank", { accountNumber: e.target.value })}
        error={errors.accountNumber}
        autoComplete="off"
      />
    </div>
  );
}

export function MenuStep({ errors }: { errors: Errors }) {
  const m = useDraft((s) => s.app.menu);
  const update = useDraft((s) => s.update);
  return (
    <div className={styles.fields}>
      <ChoiceGroup legend="How would you like to send your menu?" hint="Required" required complete>
        <Choice
          type="radio"
          name="menu-method"
          checked={m.method === "file"}
          onChange={() => update("menu", { method: "file", fileName: "" })}
          label={
            <span className={styles.option}>
              <strong>Upload your menu file</strong>
              <small>PDF, Word or Excel with dishes and prices</small>
            </span>
          }
        />
        <Choice
          type="radio"
          name="menu-method"
          checked={m.method === "photo"}
          onChange={() => update("menu", { method: "photo", fileName: "" })}
          label={
            <span className={styles.option}>
              <strong>Send a photo, we'll type it up</strong>
              <small>A clear photo of your printed or board menu. Ready for you to check in 2 days.</small>
            </span>
          }
        />
        <Choice
          type="radio"
          name="menu-method"
          checked={m.method === "later"}
          onChange={() => update("menu", { method: "later", fileName: "" })}
          label={
            <span className={styles.option}>
              <strong>Add it myself later</strong>
              <small>Use the menu manager once you're approved</small>
            </span>
          }
        />
      </ChoiceGroup>
      {m.method !== "later" && (
        <FileField
          label={m.method === "file" ? "Menu file" : "Photo of your menu"}
          hint={
            m.method === "file"
              ? "PDF, Word or Excel, up to 10 MB"
              : "JPG or PNG. Take it in good light, straight on."
          }
          accept={
            m.method === "file"
              ? "application/pdf,.doc,.docx,.xls,.xlsx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "image/jpeg,image/png"
          }
          value={m.fileName}
          onChange={(fileName) => update("menu", { fileName })}
          error={errors.fileName}
        />
      )}
    </div>
  );
}

/** Everything entered, grouped by step, each with a way back to change it. */
export function ReviewStep({ goTo }: { goTo: (step: number) => void }) {
  const { business: b, owner: o, documents: d, bank: k, menu: m } = useDraft((s) => s.app);
  const groups: Array<[number, Array<[string, string]>]> = [
    [
      0,
      [
        ["Business", b.name],
        ["Type", businessTypes.find((t) => t.value === b.type)?.label ?? ""],
        ["Address", `${b.address}, ${b.city}`],
        ["BR number", b.brNumber],
      ],
    ],
    [
      1,
      [
        ["Owner", o.name],
        ["Mobile", `+94 ${o.phone}`],
        ["Email", o.email],
        ["NIC", o.nic],
      ],
    ],
    [
      2,
      [
        ["Business registration", d.registration],
        ["Food safety", d.foodSafety],
        ["Owner's ID", d.ownerId],
      ],
    ],
    [
      3,
      [
        ["Bank", `${k.bank}, ${k.branch}`],
        ["Account name", k.accountName],
        ["Account number", `ending ${k.accountNumber.replace(/\s/g, "").slice(-4)}`],
      ],
    ],
    [
      4,
      [
        [
          "Menu",
          m.method === "later"
            ? "Adding it later"
            : m.method === "photo"
              ? `Photo to type up: ${m.fileName}`
              : m.fileName,
        ],
      ],
    ],
  ];
  return (
    <div className={styles.review}>
      {groups.map(([step, rows]) => (
        <section key={step} className={styles.reviewGroup} aria-labelledby={`review-${step}`}>
          <div className={styles.reviewHead}>
            <h3 id={`review-${step}`}>{steps[step]}</h3>
            <button type="button" className={styles.change} onClick={() => goTo(step)}>
              Change<span className="kd-visually-hidden"> {steps[step]?.toLowerCase()}</span>
            </button>
          </div>
          <dl>
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
