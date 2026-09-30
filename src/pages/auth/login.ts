import type { APIRoute } from "astro";
import { GOOGLE_AUTH, redirectUri, safeNext, writeOAuthState } from "../../lib/server/auth";
import { googleConfigured, sessionSecret } from "../../lib/server/context";
import { pkceChallenge, randomToken } from "../../lib/server/crypto";

/** Start the Google round trip: remember state + PKCE verifier, then hand off. */
export const GET: APIRoute = async ({ url, cookies, locals, redirect }) => {
  const env = locals.runtime.env;
  const next = safeNext(url.searchParams.get("next"));
  if (!googleConfigured(env)) {
    return redirect(`/login?error=setup&next=${encodeURIComponent(next)}`);
  }

  const verifier = randomToken(48);
  const state = randomToken(24);
  await writeOAuthState(cookies, url, sessionSecret(env)!, { state, verifier, next });

  const target = new URL(GOOGLE_AUTH);
  target.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  target.searchParams.set("redirect_uri", redirectUri(url));
  target.searchParams.set("response_type", "code");
  target.searchParams.set("scope", "openid email profile");
  target.searchParams.set("state", state);
  target.searchParams.set("code_challenge", await pkceChallenge(verifier));
  target.searchParams.set("code_challenge_method", "S256");
  // Always show the chooser: on a shared family laptop the account already
  // signed in to Google is often not the one that should be cooking.
  target.searchParams.set("prompt", "select_account");
  return redirect(target.toString(), 302);
};
