import { Button, Container, Link, TextField, useToast } from "@kade/ui";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import {
  AccountError,
  DEMO_CODE,
  RESEND_AFTER_SECONDS,
  formatPhone,
  normalisePhone,
  requestCode,
  signInWithProvider,
  verifyCode,
} from "@/api/account";
import { signInWithKeycloak } from "@/api/auth";
import { IS_LIVE } from "@/api/config";
import { useSaveProfile } from "@/api/queries";
import type { SignInResult, User } from "@/api/types";
import { CodeInput } from "@/components/CodeInput";
import { firstName, safeNext, useSession } from "@/features/account/session";
import { SiteHeader } from "@/layout/SiteHeader";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useNow } from "@/lib/useNow";
import styles from "./SignInPage.module.css";

type Step = "phone" | "code" | "name";

const copy: Record<Step, { title: string; text: string }> = {
  phone: IS_LIVE
    ? {
        title: "Sign in to Kadé",
        text: "Use your Kadé account to order, track deliveries and keep your addresses and cards. New to Kadé? Creating an account takes a minute.",
      }
    : {
        title: "Sign in with your phone number",
        text: "We'll text you a 6-digit code. New to Kadé? The same steps create your account.",
      },
  code: { title: "Enter the code we texted you", text: "" },
  name: {
    title: "What should riders call you?",
    text: "Your name goes on the bag and on the rider's screen, so they know who to ask for at the gate.",
  },
};

const errorText = (err: unknown) =>
  err instanceof AccountError ? err.message : "That didn't work. Check your connection and try again.";

export function SignInPage() {
  useDocumentTitle("Sign in");
  const toast = useToast();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const user = useSession((s) => s.user);
  const signIn = useSession((s) => s.signIn);
  const saveProfile = useSaveProfile();

  const location = useLocation();
  // Live: Keycloak sends new customers back here (from /auth/callback) to add their name.
  const fromCallback = IS_LIVE && params.get("step") === "name";
  const [step, setStep] = useState<Step>(fromCallback ? "name" : "phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState(0);
  const [pending, setPending] = useState<"phone" | "code" | "google" | "apple" | "kade" | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState<User>(
    (fromCallback && (location.state as { draft?: User } | null)?.draft) || { name: "", phone: "" },
  );
  const now = useNow(1000, step === "code");
  const waitSeconds = Math.max(0, RESEND_AFTER_SECONDS - Math.floor((now - sentAt) / 1000));

  // Signing in (or arriving already signed in) goes straight on to wherever they were headed
  if (user) return <Navigate to={next} replace />;

  const finish = ({ user: u, isNew }: SignInResult) => {
    if (isNew) {
      setDraft(u);
      setError(undefined);
      setStep("name");
      return;
    }
    toast({ title: `Signed in as ${firstName(u)}`, tone: "success" });
    signIn(u);
  };

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    const normalised = normalisePhone(phoneInput);
    if (!normalised) {
      setError("Enter a Sri Lankan mobile number: 9 digits after +94, starting with 7, like 77 123 4567.");
      return;
    }
    setPending("phone");
    setError(undefined);
    try {
      await requestCode(normalised);
      setPhone(normalised);
      setCode("");
      setSentAt(Date.now());
      setStep("code");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  };

  const verify = async (value: string) => {
    setPending("code");
    setError(undefined);
    try {
      finish(await verifyCode(phone, value));
    } catch (err) {
      setError(errorText(err));
      setCode("");
    } finally {
      setPending(null);
    }
  };

  const withKade = async (register = false) => {
    setPending("kade");
    setError(undefined);
    try {
      await signInWithKeycloak(next, { register });
    } catch {
      setPending(null);
      setError("We couldn't reach the Kadé sign-in page. Check your connection and try again.");
    }
  };

  const withProvider = async (provider: "google" | "apple") => {
    setPending(provider);
    setError(undefined);
    try {
      finish(await signInWithProvider(provider));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  };

  const createAccount = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      const saved = await saveProfile.mutateAsync(draft);
      toast({ title: `Welcome to Kadé, ${firstName(saved)}`, tone: "success" });
      signIn(saved);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const { title, text } = copy[step];

  return (
    <>
      <SiteHeader minimal />
      <main id="main">
        <Container className={styles.page}>
          <section className={styles.band} aria-labelledby="signin-title">
            <h1 id="signin-title" className={styles.title} aria-live="polite">
              {title}
            </h1>
            <p className={styles.lead}>
              {step === "code" ? `Sent to ${formatPhone(phone)}. It can take a few seconds to arrive.` : text}
            </p>
          </section>

          <div className={styles.panel}>
            {step === "phone" && IS_LIVE && (
              <div className={styles.form}>
                <Button size="lg" fullWidth disabled={pending !== null} onClick={() => void withKade()}>
                  {pending === "kade" ? "Opening Kadé sign-in…" : "Sign in with Kadé"}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  fullWidth
                  disabled={pending !== null}
                  onClick={() => void withKade(true)}
                >
                  Create a Kadé account
                </Button>
                {error && (
                  <p className={styles.demo} role="alert">
                    {error}
                  </p>
                )}
                <p className={styles.demo}>Demo account: dilini, password kade123.</p>
              </div>
            )}

            {step === "phone" && !IS_LIVE && (
              <>
                <form onSubmit={sendCode} noValidate className={styles.form}>
                  <TextField
                    label="Mobile number"
                    prefix="+94"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="77 123 4567"
                    value={phoneInput}
                    onChange={(e) => {
                      setPhoneInput(e.target.value);
                      setError(undefined);
                    }}
                    error={error}
                    autoFocus
                  />
                  <Button type="submit" size="lg" fullWidth disabled={pending !== null}>
                    {pending === "phone" ? "Sending code…" : "Text me a code"}
                  </Button>
                </form>
                <p className={styles.or}>or</p>
                <div className={styles.providers}>
                  <Button
                    variant="outline"
                    size="lg"
                    fullWidth
                    disabled={pending !== null}
                    onClick={() => withProvider("google")}
                  >
                    {pending === "google" ? "Opening Google…" : "Continue with Google"}
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    fullWidth
                    disabled={pending !== null}
                    onClick={() => withProvider("apple")}
                  >
                    {pending === "apple" ? "Opening Apple…" : "Continue with Apple"}
                  </Button>
                </div>
              </>
            )}

            {step === "code" && (
              <form
                className={styles.form}
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.length === 6) void verify(code);
                  else setError("Enter all 6 digits from the text.");
                }}
              >
                <CodeInput
                  label="6-digit code"
                  value={code}
                  disabled={pending === "code"}
                  error={error}
                  onChange={(v) => {
                    setCode(v);
                    setError(undefined);
                    if (v.length === 6) void verify(v);
                  }}
                />
                <p className={styles.demo}>This demo doesn't send texts. Use {DEMO_CODE}.</p>
                <Button type="submit" size="lg" fullWidth disabled={pending !== null}>
                  {pending === "code" ? "Checking…" : "Sign in"}
                </Button>
                <div className={styles.secondary}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={waitSeconds > 0 || pending !== null}
                    onClick={() => void sendCode()}
                  >
                    {waitSeconds > 0 ? `Send a new code in ${waitSeconds}s` : "Send a new code"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setStep("phone");
                      setError(undefined);
                    }}
                  >
                    Change number
                  </Button>
                </div>
              </form>
            )}

            {step === "name" && (
              <form onSubmit={createAccount} noValidate className={styles.form}>
                <TextField
                  label="Your name"
                  autoComplete="name"
                  placeholder="Dilini Perera"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  error={error}
                  autoFocus
                />
                <TextField
                  label="Email for receipts"
                  hint="Optional"
                  type="email"
                  autoComplete="email"
                  value={draft.email ?? ""}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
                <Button type="submit" size="lg" fullWidth disabled={saveProfile.isPending}>
                  {saveProfile.isPending ? "Creating account…" : "Create account"}
                </Button>
              </form>
            )}

            <p className={styles.legal}>
              By continuing you agree to Kadé's <Link href="/help#privacy">terms and privacy policy</Link>.
            </p>
          </div>
        </Container>
      </main>
    </>
  );
}
