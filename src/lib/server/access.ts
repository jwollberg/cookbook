/**
 * Checking that Cloudflare Access let this visitor in.
 *
 * Access stands in front of the whole hostname: it does the Google sign-in
 * (one login shared by every Atheos app) and signs each request it passes
 * with a JWT (header `Cf-Access-Jwt-Assertion`, cookie `CF_Authorization`).
 * We verify that signature against the team's public keys, the audience
 * (this app), the issuer and the expiry. The middleware then checks the email
 * against ALLOWED_EMAILS, so a mistake in the Access policy still lets nobody
 * in — it fails closed.
 *
 * Same check as Budget and Home (Website-Budget/src/lib/server/access.ts).
 */

import { fromBase64Url } from "./crypto";

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

let certCache: { team: string; keys: Jwk[]; at: number } | null = null;

async function teamKeys(team: string, force = false): Promise<Jwk[]> {
  if (!force && certCache && certCache.team === team && Date.now() - certCache.at < 3_600_000) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  certCache = { team, keys: body.keys ?? [], at: Date.now() };
  return certCache.keys;
}

/** Tests only: forget the cached keys. */
export function resetAccessKeys(): void {
  certCache = null;
}

const dec = new TextDecoder();
const enc = new TextEncoder();

export interface AccessClaims {
  email: string;
}

export async function verifyAccessJwt(
  token: string | null | undefined,
  env: Pick<Env, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD">,
  now = Date.now(),
): Promise<AccessClaims | null> {
  const team = env.ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = env.ACCESS_AUD?.trim();
  if (!token || !team || !aud) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(dec.decode(fromBase64Url(parts[0]))) as { alg?: string; kid?: string };
    const payload = JSON.parse(dec.decode(fromBase64Url(parts[1]))) as {
      aud?: string | string[];
      exp?: number;
      nbf?: number;
      iss?: string;
      email?: string;
    };
    if (header.alg !== "RS256" || !header.kid) return null;

    let jwk = (await teamKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await teamKeys(team, true)).find((k) => k.kid === header.kid); // keys rotate
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromBase64Url(parts[2]),
      enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;

    const seconds = now / 1000;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(aud)) return null;
    if (typeof payload.exp !== "number" || payload.exp <= seconds) return null;
    if (typeof payload.nbf === "number" && payload.nbf > seconds + 60) return null;
    // The team answers to more than one name (its team domain and its generated
    // "team name"), so any *.cloudflareaccess.com issuer is fine: the signature
    // above was checked against THIS team's keys, and the audience is this app.
    if (typeof payload.iss !== "string" || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(payload.iss)) {
      return null;
    }
    if (typeof payload.email !== "string" || !payload.email) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

export function accessToken(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Signing out of Kitchen means signing out of Access for this hostname. */
export const SIGN_OUT_URL = "/cdn-cgi/access/logout";
