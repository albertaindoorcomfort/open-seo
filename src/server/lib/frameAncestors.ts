/**
 * The `frame-ancestors` policy for app documents. Only the app itself may frame
 * them, plus the exact https origins listed in OPEN_SEO_FRAME_ANCESTORS
 * (space separated), such as a staff portal that shows the app inside its own
 * pages. Anything that is not a bare https origin is ignored, so a typo can
 * only narrow the policy, never widen it to a wildcard.
 */
export function frameAncestorsPolicy(raw: string | undefined): string {
  const origins = new Set<string>();
  for (const entry of (raw ?? "").split(/\s+/)) {
    if (!entry) continue;
    try {
      const u = new URL(entry);
      if (
        u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        !u.hostname.includes("*") &&
        u.origin === entry.replace(/\/$/, "")
      ) {
        origins.add(u.origin);
      }
    } catch {
      // not a URL: ignored
    }
  }
  return ["frame-ancestors 'self'", ...origins].join(" ");
}
