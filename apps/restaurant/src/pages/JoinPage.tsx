import { Button, Choice, Icon, cx, useToast } from "@kade/ui";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useSubmitApplication } from "@/api/queries";
import { steps, useDraft, validate } from "@/features/join/draft";
import { JoinLayout } from "@/features/join/JoinLayout";
import {
  BankStep,
  BusinessStep,
  DocumentsStep,
  MenuStep,
  OwnerStep,
  ReviewStep,
} from "@/features/join/JoinSteps";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./JoinPage.module.css";

const intros = [
  "Tell us about the place customers will order from.",
  "The person we contact about the account and payouts.",
  "We check these before you go live. It usually takes a day.",
  "Where your weekly payouts go.",
  "We set up your menu on Kadé, then you check it before going live.",
  "Check everything once. You can change it until we approve you.",
];

/** Partner sign-up: six steps in order, saved on this device as you go. */
export function JoinPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { step, app, setStep, reset } = useDraft();
  const submit = useSubmitApplication();
  const [showErrors, setShowErrors] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useDocumentTitle(`Become a partner: ${steps[step]}`);

  // Move focus to the new step's heading, so keyboard and screen reader users start at the top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  const errors = showErrors ? validate(step, app) : {};
  const last = step === steps.length - 1;

  const goTo = (n: number) => {
    setShowErrors(false);
    setStep(n);
  };

  const next = () => {
    if (!last) {
      if (Object.keys(validate(step, app)).length) {
        setShowErrors(true);
        return;
      }
      goTo(step + 1);
      return;
    }
    if (!confirmed) return setConfirmError(true);
    const incomplete = steps.findIndex((_, i) => Object.keys(validate(i, app)).length > 0);
    if (incomplete >= 0 && incomplete < steps.length - 1) {
      setStep(incomplete);
      setShowErrors(true);
      return;
    }
    submit.mutate(app, {
      onSuccess: () => {
        reset();
        navigate("/join/status");
      },
      onError: (e) => toast({ title: "Application not sent", description: e.message, tone: "error" }),
    });
  };

  return (
    <JoinLayout>
      <div className={styles.layout}>
        <aside className={styles.intro}>
          <h1 className={styles.title}>Sell on Kadé</h1>
          <p className={styles.pitch}>
            Reach hungry people across Colombo. No setup fee, 18% commission on orders, paid every Tuesday.
          </p>
          <ol className={styles.steps} aria-label="Sign-up steps">
            {steps.map((s, i) => {
              const done = i < step;
              return (
                <li
                  key={s}
                  className={cx(styles.step, done && styles.stepDone, i === step && styles.stepNow)}
                  aria-current={i === step ? "step" : undefined}
                >
                  <span className={styles.stepNumber} aria-hidden="true">
                    {done ? <Icon name="check" size={16} /> : i + 1}
                  </span>
                  {done ? (
                    <button type="button" className={styles.stepLink} onClick={() => goTo(i)}>
                      {s}
                      <span className="kd-visually-hidden">, done. Change</span>
                    </button>
                  ) : (
                    <span>{s}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </aside>

        <form
          className={styles.form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
          aria-labelledby="step-title"
        >
          <p className={styles.progress}>
            Step {step + 1} of {steps.length}
          </p>
          <div className={styles.bar} aria-hidden="true">
            <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <h2 id="step-title" ref={headingRef} tabIndex={-1} className={styles.stepTitle}>
            {steps[step]}
          </h2>
          <p className={styles.stepIntro}>{intros[step]}</p>

          {step === 0 && <BusinessStep errors={errors} />}
          {step === 1 && <OwnerStep errors={errors} />}
          {step === 2 && <DocumentsStep errors={errors} />}
          {step === 3 && <BankStep errors={errors} />}
          {step === 4 && <MenuStep errors={errors} />}
          {step === 5 && (
            <>
              <ReviewStep goTo={goTo} />
              <div className={styles.confirm}>
                <Choice
                  type="checkbox"
                  label="I confirm these details are correct and I'm allowed to sign up this business"
                  checked={confirmed}
                  onChange={(e) => {
                    setConfirmed(e.target.checked);
                    setConfirmError(false);
                  }}
                />
                {confirmError && (
                  <p className={styles.error} role="alert">
                    Tick the box to confirm before submitting.
                  </p>
                )}
              </div>
            </>
          )}

          {showErrors && Object.keys(errors).length > 0 && (
            <p className={styles.error} role="alert">
              Fix the {Object.keys(errors).length === 1 ? "field" : `${Object.keys(errors).length} fields`}{" "}
              marked above to continue.
            </p>
          )}

          <div className={styles.actions}>
            {step > 0 && (
              <Button variant="secondary" size="lg" icon="chevronLeft" onClick={() => goTo(step - 1)}>
                Back
              </Button>
            )}
            <Button type="submit" size="lg" disabled={submit.isPending} className={styles.next}>
              {last ? (submit.isPending ? "Submitting…" : "Submit application") : "Continue"}
            </Button>
          </div>
          <p className={styles.saved}>Your answers are saved on this device as you go.</p>
        </form>
      </div>
    </JoinLayout>
  );
}
