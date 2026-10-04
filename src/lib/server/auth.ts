/**
 * Who may use Kitchen.
 *
 * Signing in is Cloudflare Access's job (Google, shared by every Atheos app —
 * see ./access.ts). This is the second lock: an account must also be on
 * ALLOWED_EMAILS, checked on every request, and an empty or missing list lets
 * nobody in rather than everybody.
 */

/**
 * Compare addresses the way Google does. Gmail ignores dots in the local
 * part and anything after a "+", so j.o.s.h+food@gmail.com is
 * josh@gmail.com; who gets in should not depend on how someone typed theirs.
 */
export function canonicalEmail(email: string): string {
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at < 1) return clean;
  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
  }
  return `${local}@${domain}`;
}

export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"))
      .map(canonicalEmail),
  );
}

export function isAllowed(email: string | undefined, raw: string | undefined): boolean {
  if (!email) return false;
  return parseAllowlist(raw).has(canonicalEmail(email));
}

/**
 * Where to send someone back to after a form post. Only same-site paths: an
 * open redirect is the classic way to lend a phishing link your domain.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/cdn-cgi/")) return "/";
  return next;
}
