import { Icon } from "@kade/ui";
import styles from "./Contact.module.css";

/** Call and message links for a person. Uses the device's phone and SMS apps. */
export function Contact({ name, phone, email }: { name: string; phone: string; email?: string }) {
  const tel = phone.replaceAll(" ", "");
  return (
    <div className={styles.contact}>
      <a className={styles.link} href={`tel:${tel}`} aria-label={`Call ${name}, ${phone}`}>
        <Icon name="phone" size={16} />
        Call
      </a>
      <a className={styles.link} href={`sms:${tel}`} aria-label={`Text ${name}`}>
        <Icon name="chat" size={16} />
        Text
      </a>
      {email && (
        <a className={styles.link} href={`mailto:${email}`} aria-label={`Email ${name}`}>
          <Icon name="mail" size={16} />
          Email
        </a>
      )}
      <span className={styles.phone}>{phone}</span>
    </div>
  );
}
