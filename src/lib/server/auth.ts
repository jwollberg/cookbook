/**
 * Google sign-in and the allowlist.
 *
 * The flow is authorization code + PKCE, entirely server-side: the browser
 * never sees a Google token, only our own signed session cookie. The site is
 * closed by default — an account must be on ALLOWED_EMAILS to get in, and an
 * empty or missing list lets nobody in rather than everybody.
 */

import type { AstroCookies } from "astro";
import { fromBase64Url, sign, unsign } from "./crypto";

export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

/** Thirty days: this is used on a phone in a shop, not a bank. */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** The sign-in round trip must finish within ten minutes. */
export const OAUTH_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Google ID token
// ---------------------------------------------------------------------------

export interface GoogleClaims {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
  exp: number;
}

export function decodeIdToken(idToken: string): GoogleClaims | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as GoogleClaims;
  } catch {
    return null;
  }
}

/**
 * Check the claims that matter. The token arrives straight from Google's
 * token endpoint over TLS in exchange for our client secret, which is what
 * Google documents as sufficient in place of verifying the signature — but
 * the audience, issuer, expiry and verified address are still ours to check.
 *
 * Returns a reason on failure, null when the token is good.
 */
export function checkClaims(claims: GoogleClaims | null, clientId: string, now = Date.now()): string | null {
  if (!claims) return "unreadable ID token";
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") {
    return "wrong issuer";
  }
  if (claims.aud !== clientId) return "token was issued to a different app";
  if (!claims.exp || claims.exp * 1000 <= now) return "token expired";
  if (!claims.sub) return "no subject";
  if (!claims.email || claims.email_verified !== true) return "email address not verified";
  return null;
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export interface SessionPayload {
  uid: string;
  email: string;
  exp: number;
}

export interface OAuthPayload {
  state: string;
  verifier: string;
  next: string;
  exp: number;
}

/**
 * `__Host-` pins a cookie to exactly this origin over HTTPS (no Domain, Path=/,
 * Secure). Plain http on 127.0.0.1 in development cannot carry one, so the dev
 * server uses unprefixed names.
 */
function cookieName(base: string, url: URL): string {
  return url.protocol === "https:" ? `__Host-${base}` : base;
}

const cookieOptions = (url: URL, maxAgeMs: number) => ({
  path: "/",
  httpOnly: true,
  secure: url.protocol === "https:",
  sameSite: "lax" as const,
  maxAge: Math.floor(maxAgeMs / 1000),
});

export async function readSession(
  cookies: AstroCookies,
  url: URL,
  secret: string | undefined,
): Promise<SessionPayload | null> {
  return unsign<SessionPayload>(cookies.get(cookieName("kitchen_session", url))?.value, secret);
}

export async function writeSession(
  cookies: AstroCookies,
  url: URL,
  secret: string,
  user: { uid: string; email: string },
): Promise<void> {
  const token = await sign({ ...user, exp: Date.now() + SESSION_MS }, secret);
  cookies.set(cookieName("kitchen_session", url), token, cookieOptions(url, SESSION_MS));
}

export function clearSession(cookies: AstroCookies, url: URL): void {
  cookies.delete(cookieName("kitchen_session", url), { path: "/" });
}

export async function writeOAuthState(
  cookies: AstroCookies,
  url: URL,
  secret: string,
  state: Omit<OAuthPayload, "exp">,
): Promise<void> {
  const token = await sign({ ...state, exp: Date.now() + OAUTH_MS }, secret);
  cookies.set(cookieName("kitchen_oauth", url), token, cookieOptions(url, OAUTH_MS));
}

/** Read and immediately discard: a state value is good for one callback. */
export async function takeOAuthState(
  cookies: AstroCookies,
  url: URL,
  secret: string | undefined,
): Promise<OAuthPayload | null> {
  const name = cookieName("kitchen_oauth", url);
  const payload = await unsign<OAuthPayload>(cookies.get(name)?.value, secret);
  cookies.delete(name, { path: "/" });
  return payload;
}

/**
 * Where to go after signing in. Only same-site paths: an open redirect on a
 * login page is the classic way to lend a phishing link your domain.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/auth/") || next.startsWith("/login")) return "/";
  return next;
}

export function redirectUri(url: URL): string {
  return `${url.origin}/auth/callback`;
}
