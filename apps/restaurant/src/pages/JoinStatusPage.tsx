import { Button, Icon, cx } from "@kade/ui";
import { useApplication } from "@/api/queries";
import { JoinLayout } from "@/features/join/JoinLayout";
import { shortDate } from "@/lib/time";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import styles from "./JoinStatusPage.module.css";

/** After submitting: where the application is and what happens next, with honest timings. */
export function JoinStatusPage() {
  useDocumentTitle("Application received");
  const { data: application, isPending } = useApplication();

  if (isPending)
    return (
      <JoinLayout>
        <p className={styles.muted}>Loading your application…</p>
      </JoinLayout>
    );

  if (!application)
    return (
      <JoinLayout>
        <div className={styles.page}>
          <h1 className={styles.title}>No application on this device</h1>
          <p className={styles.lead}>Start one now. It takes about 10 minutes with your documents to hand.</p>
          <Button href="/join" size="lg">
            Start your application
          </Button>
        </div>
      </JoinLayout>
    );

  const stages: Array<{ title: string; when: string; detail: string }> = [
    {
      title: "Application received",
      when: shortDate(application.submittedAt),
      detail: `Reference ${application.reference}. Keep it for any call with us.`,
    },
    {
      title: "Documents checked",
      when: "1 to 2 working days",
      detail: `If anything is unclear we call ${application.phone.startsWith("+") ? application.phone : `+94 ${application.phone}`}.`,
    },
    {
      title: "Menu set up",
      when: "2 to 3 working days",
      detail: "We put your menu on Kadé and you check it before anyone can order.",
    },
    {
      title: "Tablet and training",
      when: "About 30 minutes at your kitchen",
      detail: "A partner manager brings the tablet and printer and shows your team the orders board.",
    },
    { title: "Live on Kadé", when: "Usually within 7 working days", detail: "Orders start coming in." },
  ];

  return (
    <JoinLayout>
      <div className={styles.page}>
        <h1 className={styles.title}>We're reviewing your application</h1>
        <p className={styles.lead}>
          Thanks for applying with {application.businessName}. We'll text you at each step, so there's no need
          to check back here.
        </p>
        <ol className={styles.timeline}>
          {stages.map((s, i) => (
            <li key={s.title} className={cx(styles.stage, i === 0 && styles.done, i === 1 && styles.now)}>
              <span className={styles.marker} aria-hidden="true">
                {i === 0 ? <Icon name="check" size={18} /> : i + 1}
              </span>
              <div>
                <h2 className={styles.stageTitle}>
                  {s.title}
                  <span className="kd-visually-hidden">
                    {i === 0 ? ", done" : i === 1 ? ", in progress" : ""}
                  </span>
                </h2>
                <p className={styles.when}>{s.when}</p>
                <p className={styles.detail}>{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className={styles.help}>
          Questions? Call partner support on <a href="tel:+94112345600">011 234 5600</a>, 8 am to 8 pm every
          day.
        </p>
      </div>
    </JoinLayout>
  );
}
