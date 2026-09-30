/**
 * Signed, stateless tokens (WebCrypto, so it runs unchanged in a Worker, in
 * Node for the tests, and in the dev server).
 *
 * A token is base64url(JSON payload) + "." + base64url(HMAC-SHA256 of it),
 * keyed by SESSION_SECRET. Nothing is stored server-side: a valid signature
 * and an unexpired `exp` are the whole check.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export interface Expiring {
  /** Expiry, ms since epoch. */
  exp: number;
}

export async function sign(payload: Expiring & Record<string, unknown>, secret: string): Promise<string> {
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/** The payload, or null for anything forged, malformed, or expired. */
export async function unsign<T extends Expiring>(
  token: string | null | undefined,
  secret: string | undefined,
  now = Date.now(),
): Promise<T | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  try {
    // crypto.subtle.verify compares in constant time.
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromBase64Url(body))) as T;
    if (typeof payload?.exp !== "number" || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge for a verifier (RFC 7636). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}
