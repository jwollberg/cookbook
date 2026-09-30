import type { APIRoute } from "astro";
import {
  GOOGLE_TOKEN,
  checkClaims,
  decodeIdToken,
  isAllowed,
  redirectUri,
  takeOAuthState,
  writeSession,
} from "../../lib/server/auth";
import { googleConfigured, sessionSecret } from "../../lib/server/context";
import { ensureHousehold, upsertUser } from "../../lib/server/db";

/** Google sends the browser back here with a one-time code. */
export const GET: APIRoute = async ({ url, cookies, locals, redirect }) => {
  const env = locals.runtime.env;
  const secret = sessionSecret(env);
  if (!googleConfigured(env) || !secret) return redirect("/login?error=setup");

  const saved = await takeOAuthState(cookies, url, secret);
  if (url.searchParams.get("error")) return redirect("/login?error=cancelled");

  const code = url.searchParams.get("code");
  if (!saved || !code || url.searchParams.get("state") !== saved.state) {
    return redirect("/login?error=expired");
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(url),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenResponse.ok) {
    console.error("Google token exchange failed", tokenResponse.status, await tokenResponse.text());
    return redirect("/login?error=google");
  }

  const tokens = (await tokenResponse.json()) as { id_token?: string };
  const claims = tokens.id_token ? decodeIdToken(tokens.id_token) : null;
  const problem = checkClaims(claims, env.GOOGLE_CLIENT_ID!);
  if (problem || !claims?.email) {
    console.error("Rejected Google ID token:", problem);
    return redirect("/login?error=google");
  }

  if (!isAllowed(claims.email, env.ALLOWED_EMAILS)) return redirect("/login?error=not-allowed");

  const viewer = await upsertUser(env.DB, {
    id: claims.sub,
    email: claims.email,
    name: claims.name ?? claims.given_name ?? null,
    picture: claims.picture ?? null,
  });
  await ensureHousehold(env.DB, viewer);
  await writeSession(cookies, url, secret, { uid: viewer.id, email: viewer.email });
  return redirect(saved.next);
};
