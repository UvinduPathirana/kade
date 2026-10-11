import { Button, ConfirmDialog, Panel, Select, Switch, TextField, useToast } from "@kade/ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { isLive } from "@/api/config";
import { useOutlet, usePrintTest, useSaveDetails, useSaveSettings, useSettings } from "@/api/queries";
import type { DeviceSettings, NotificationSettings, Outlet, PartnerSettings } from "@/api/types";
import { useSound } from "@/features/alerts/store";
import { StaffPanel } from "@/features/settings/StaffPanel";
import { signedInName, signOut } from "@/auth/auth";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./SettingsPage.module.css";
import shared from "@/features/settings/Settings.module.css";

export function SettingsPage() {
  useDocumentTitle("Staff and settings");
  const { data: settings } = useSettings();
  const { data: outlet } = useOutlet();
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Staff and settings</h1>
      <StaffPanel />
      {settings && <DevicesPanel key={settings.devices.printerName} settings={settings} />}
      {settings && <NotificationsPanel settings={settings} />}
      {outlet && <OutletPanel key={`${outlet.name}|${outlet.address}|${outlet.phone}`} outlet={outlet} />}
      <SignOutPanel />
    </div>
  );
}

function DevicesPanel({ settings }: { settings: PartnerSettings }) {
  const toast = useToast();
  const save = useSaveSettings();
  const test = usePrintTest();
  const [printerName, setPrinterName] = useState(settings.devices.printerName);
  const set = (devices: Partial<DeviceSettings>, title = "Printer saved") =>
    save.mutate(
      { ...settings, devices: { ...settings.devices, ...devices } },
      { onSuccess: () => toast({ title }) },
    );

  return (
    <Panel title="Printer" titleId="printer-title" className={shared.panel}>
      <div className={shared.switches}>
        <Switch
          size="lg"
          label="Print tickets automatically"
          description="A kitchen ticket prints the moment you accept an order"
          checked={settings.devices.autoPrint}
          onChange={(autoPrint) => set({ autoPrint }, autoPrint ? "Auto-print on" : "Auto-print off")}
        />
      </div>
      <form
        className={shared.fields}
        onSubmit={(e) => {
          e.preventDefault();
          if (!printerName.trim()) return;
          save.mutate(
            { ...settings, devices: { ...settings.devices, printerName: printerName.trim() } },
            { onSuccess: () => toast({ title: "Printer saved", tone: "success" }) },
          );
        }}
      >
        <TextField
          label="Printer name"
          value={printerName}
          onChange={(e) => setPrinterName(e.target.value)}
          hint="As it shows in the tablet's Bluetooth or Wi-Fi settings"
          action={
            printerName.trim() !== settings.devices.printerName ? (
              <Button type="submit" size="sm">
                Save
              </Button>
            ) : undefined
          }
        />
        <Select
          label="Paper width"
          value={settings.devices.paperWidth}
          onChange={(e) => set({ paperWidth: e.target.value as DeviceSettings["paperWidth"] })}
          options={[
            { value: "80", label: "80 mm" },
            { value: "58", label: "58 mm" },
          ]}
        />
        <Select
          label="Copies of each ticket"
          value={String(settings.devices.copies)}
          onChange={(e) => set({ copies: Number(e.target.value) as 1 | 2 })}
          options={[
            { value: "1", label: "1 copy" },
            { value: "2", label: "2 copies, kitchen and counter" },
          ]}
        />
      </form>
      <div className={shared.actions}>
        <Button
          variant="secondary"
          size="lg"
          icon="printer"
          disabled={test.isPending}
          onClick={() =>
            test.mutate(undefined, {
              onSuccess: (printer) =>
                toast({
                  title: "Test ticket sent",
                  description: `Check ${printer} for a short sample ticket.`,
                }),
            })
          }
        >
          {test.isPending ? "Sending…" : "Print a test ticket"}
        </Button>
      </div>
    </Panel>
  );
}

function NotificationsPanel({ settings }: { settings: PartnerSettings }) {
  const toast = useToast();
  const save = useSaveSettings();
  const { soundOn, setSoundOn } = useSound();
  const set = (n: Partial<NotificationSettings>, title: string) =>
    save.mutate(
      { ...settings, notifications: { ...settings.notifications, ...n } },
      { onSuccess: () => toast({ title }) },
    );
  const n = settings.notifications;

  return (
    <Panel title="Notifications" titleId="notifications-title" className={shared.panel}>
      <div className={shared.switches}>
        <Switch
          size="lg"
          label="Ring for new orders on this tablet"
          description="Repeats every 20 seconds until someone accepts or rejects"
          checked={soundOn}
          onChange={(on) => {
            setSoundOn(on);
            toast({ title: on ? "Sound on" : "Sound off" });
          }}
        />
        <Switch
          size="lg"
          label="Text the owner when the store is paused"
          description="So nobody forgets to resume after a rush"
          checked={n.smsPaused}
          onChange={(v) => set({ smsPaused: v }, v ? "Pause texts on" : "Pause texts off")}
        />
        <Switch
          size="lg"
          label="Email weekly statements"
          description="Every Tuesday when the payout is sent"
          checked={n.emailStatements}
          onChange={(v) => set({ emailStatements: v }, v ? "Statement emails on" : "Statement emails off")}
        />
        <Switch
          size="lg"
          label="Email every new review"
          checked={n.newReviews}
          onChange={(v) => set({ newReviews: v }, v ? "Review emails on" : "Review emails off")}
        />
        <Switch
          size="lg"
          label="Text the owner about 1 and 2 star reviews"
          description="A quick reply often wins the customer back"
          checked={n.lowRatings}
          onChange={(v) => set({ lowRatings: v }, v ? "Low rating texts on" : "Low rating texts off")}
        />
      </div>
    </Panel>
  );
}

function OutletPanel({ outlet }: { outlet: Outlet }) {
  const toast = useToast();
  const save = useSaveDetails();
  const [name, setName] = useState(outlet.name);
  const [address, setAddress] = useState(outlet.address);
  const [phone, setPhone] = useState(outlet.phone);
  const dirty = name !== outlet.name || address !== outlet.address || phone !== outlet.phone;
  const invalid = !name.trim() || !address.trim() || !phone.trim();

  return (
    <Panel title="Outlet details" titleId="outlet-title" className={shared.panel}>
      <p className={shared.muted}>
        Customers see these on your page. Riders use the address and phone to find you.
      </p>
      <form
        className={shared.fields}
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          save.mutate(
            { name: name.trim(), address: address.trim(), phone: phone.trim() },
            { onSuccess: () => toast({ title: "Details saved", tone: "success" }) },
          );
        }}
      >
        <TextField
          label="Outlet name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={!name.trim() ? "Enter the outlet name." : undefined}
        />
        <TextField
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          error={!address.trim() ? "Enter the address riders come to." : undefined}
        />
        <TextField
          label="Counter phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={!phone.trim() ? "Enter a number riders can call." : undefined}
        />
        <div className={shared.actions}>
          <Button type="submit" size="lg" disabled={!dirty || invalid || save.isPending}>
            Save details
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function SignOutPanel() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const { data: outlet } = useOutlet();
  const [name, setName] = useState(isLive ? "" : "Mohamed Rizvi, owner");
  useEffect(() => {
    if (isLive) void signedInName().then((n) => setName(n ?? ""));
  }, []);
  return (
    <Panel title="This tablet" titleId="tablet-title" className={shared.panel}>
      <p className={shared.muted}>
        Signed in{name && ` as ${name}`}
        {outlet && `, ${outlet.name}, ${outlet.area}`}.
      </p>
      <div className={shared.actions}>
        <Button variant="outline" size="lg" icon="logout" onClick={() => setConfirming(true)}>
          Sign out
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Sign out of this tablet?"
        description="New orders stop ringing here until someone signs in again. Other signed-in devices keep getting orders."
        cancelLabel="Stay signed in"
        confirmLabel="Sign out"
        onConfirm={() => (isLive ? void signOut() : navigate("/signed-out"))}
      />
    </Panel>
  );
}
