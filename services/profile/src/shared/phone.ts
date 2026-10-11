/**
 * Sri Lankan mobile numbers to E.164: "077 123 4567", "77-123-4567", "+94771234567", "0094771234567"
 * all become "+94771234567". Returns null for anything that isn't a 07x mobile number.
 */
export function normalisePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0094")) d = d.slice(4);
  else if (d.startsWith("94") && d.length === 11) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return /^7\d{8}$/.test(d) ? `+94${d}` : null;
}

/** Keycloak username for a phone account: the E.164 digits, "94771234567". */
export const phoneUsername = (e164: string): string => e164.replace(/^\+/, "");

/** Placeholder email domain of phone-only Keycloak accounts (Keycloak's user profile needs one). */
export const PHONE_EMAIL_DOMAIN = "phone.kade.test";
export const isPhonePlaceholderEmail = (email: string): boolean =>
  email.toLowerCase().endsWith(`@${PHONE_EMAIL_DOMAIN}`);
