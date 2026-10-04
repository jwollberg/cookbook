/**
 * The gate: the allowlist and the Cloudflare Access token. Every one of these failing open would let a stranger
 * into the household's kitchen, so they are tested rather than trusted.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalEmail, isAllowed, safeNext } from "./auth";
import { accessToken, resetAccessKeys, verifyAccessJwt } from "./access";
import { toBase64Url } from "./crypto";

const LIST = "sam.cook@gmail.com, alex@example.com pat.baker@gmail.com";

describe("allowlist", () => {
  it("admits listed accounts", () => {
    expect(isAllowed("sam.cook@gmail.com", LIST)).toBe(true);
    expect(isAllowed("alex@example.com", LIST)).toBe(true);
  });

  it("matches Gmail the way Gmail does: no dots, no plus tags, any case", () => {
    expect(isAllowed("SamCook@Gmail.com", LIST)).toBe(true);
    expect(isAllowed("sam.cook+kitchen@googlemail.com", LIST)).toBe(true);
    expect(canonicalEmail("s.a.m+x@gmail.com")).toBe("sam@gmail.com");
  });

  it("keeps dots meaningful outside Gmail", () => {
    expect(canonicalEmail("first.last@example.com")).toBe("first.last@example.com");
    expect(isAllowed("firstlast@example.com", "first.last@example.com")).toBe(false);
  });

  it("refuses everyone else", () => {
    expect(isAllowed("someone@gmail.com", LIST)).toBe(false);
    expect(isAllowed(undefined, LIST)).toBe(false);
  });

  it("fails closed when the list is missing or empty", () => {
    expect(isAllowed("sam.cook@gmail.com", undefined)).toBe(false);
    expect(isAllowed("sam.cook@gmail.com", "  ")).toBe(false);
  });
});

describe("safeNext", () => {
  it("allows same-site paths", () => {
    expect(safeNext("/recipes/falafel?x=1")).toBe("/recipes/falafel?x=1");
  });

  it("refuses anything that could leave the site or loop", () => {
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/cdn-cgi/access/logout")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("Cloudflare Access token", () => {
  const TEAM = "team.cloudflareaccess.com";
  const AUD = "kitchen-aud";
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const enc = new TextEncoder();
  const b64 = (o: unknown) => toBase64Url(enc.encode(JSON.stringify(o)));
  let keys: CryptoKeyPair;
  let stranger: CryptoKeyPair;

  const gen = () =>
    crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    ) as Promise<CryptoKeyPair>;

  async function token(over: Record<string, unknown> = {}, signer = keys.privateKey, kid = "k1") {
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: "RS256", kid });
    const body = b64({ aud: [AUD], email: "sam.cook@gmail.com", iss: `https://${TEAM}`, exp: now + 600, ...over });
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, enc.encode(`${head}.${body}`));
    return `${head}.${body}.${toBase64Url(new Uint8Array(sig))}`;
  }

  beforeAll(async () => {
    keys = await gen();
    stranger = await gen();
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === `https://${TEAM}/cdn-cgi/access/certs`
          ? new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1" }] }))
          : new Response("no", { status: 404 }),
      ),
    );
  });
  afterEach(() => resetAccessKeys());

  it("accepts a token Access signed for this app", async () => {
    expect(await verifyAccessJwt(await token(), env)).toEqual({ email: "sam.cook@gmail.com" });
    expect(await verifyAccessJwt(await token({ aud: AUD }), env)).not.toBeNull();
  });

  it("refuses a forged signature, another app's token, an expired one, a stranger issuer", async () => {
    expect(await verifyAccessJwt(await token({}, stranger.privateKey), env)).toBeNull();
    expect(await verifyAccessJwt(await token({ aud: ["budget-aud"] }), env)).toBeNull();
    expect(await verifyAccessJwt(await token({ exp: Math.floor(Date.now() / 1000) - 1 }), env)).toBeNull();
    expect(await verifyAccessJwt(await token({ iss: "https://evil.example" }), env)).toBeNull();
    expect(await verifyAccessJwt(await token({ email: "" }), env)).toBeNull();
    expect(await verifyAccessJwt(await token({}, keys.privateKey, "unknown-kid"), env)).toBeNull();
  });

  it("fails closed when it isn't set up or there is no token", async () => {
    const good = await token();
    expect(await verifyAccessJwt(good, { ACCESS_TEAM_DOMAIN: TEAM })).toBeNull();
    expect(await verifyAccessJwt(good, { ACCESS_AUD: AUD })).toBeNull();
    expect(await verifyAccessJwt(null, env)).toBeNull();
    expect(await verifyAccessJwt("junk", env)).toBeNull();
  });

  it("reads the token from the header or the cookie", () => {
    expect(accessToken(new Request("https://k.test/", { headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } }))).toBe("a.b.c");
    expect(accessToken(new Request("https://k.test/", { headers: { Cookie: "x=1; CF_Authorization=d.e.f" } }))).toBe("d.e.f");
    expect(accessToken(new Request("https://k.test/"))).toBeNull();
  });
});
