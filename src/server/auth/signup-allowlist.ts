// Lunar Optimize: while billing runs on the placeholder ledger (no
// AUTUMN_SECRET_KEY), hosted sign-up is invite-only. The list comes from
// LUNAR_OPTIMIZE_ALLOWED_EMAILS (comma or whitespace separated); unset means
// the owner's address only.

const DEFAULT_ALLOWED_EMAILS = "DigitalTools.Mgt@albertaindoorcomfort.com";

export function parseAllowedEmails(raw: string | undefined): Set<string> {
  const source =
    raw != null && raw.trim() !== "" ? raw : DEFAULT_ALLOWED_EMAILS;
  return new Set(
    source
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(
  email: string,
  raw: string | undefined,
): boolean {
  return parseAllowedEmails(raw).has(email.trim().toLowerCase());
}
