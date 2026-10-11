/**
 * The gate: Home's People list and the Cloudflare Access token. Every one of these failing open would let a stranger
 * into someone's kitchen, so they are tested rather than trusted.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { accessToken, resetAccessKeys, verifyAccessJwt } from "./access";
import { accessFor, ownerKey, resetPeople } from "./people";
import { toBase64Url } from "./crypto";

describe("who may use Kitchen: Home's People list", () => {
  // The app's own list, which stands in only until Home first answers.
  const env = { INTERNAL_TOKEN: "t", ALLOWED_EMAILS: "sam.cook@gmail.com, alex@example.com", OWNER_EMAILS: "sam.cook@gmail.com" };
  const answer = (people: unknown[]) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ people })));

  afterEach(() => {
    vi.unstubAllGlobals();
    resetPeople();
  });

  it("follows the People list, not ALLOWED_EMAILS, once Home answers", async () => {
    answer([
      { email: "sam.cook@gmail.com", name: "Sam", owner: true, apps: ["home", "kitchen", "budget"] },
      { email: "pat.baker@gmail.com", name: "Pat", owner: false, apps: ["home", "kitchen"] },
      { email: "alex@example.com", name: "Alex", owner: false, apps: ["home"] },
    ]);
    expect(await accessFor("SamCook+food@Gmail.com", "kitchen", env)).toEqual({ allowed: true, owner: true, name: "Sam", apps: ["home", "kitchen", "budget"] });
    expect(await accessFor("pat.baker@gmail.com", "kitchen", env)).toMatchObject({ allowed: true, owner: false, apps: ["home", "kitchen"] });
    expect((await accessFor("alex@example.com", "kitchen", env)).allowed).toBe(false); // on ALLOWED_EMAILS, not given Kitchen
    expect((await accessFor("someone@gmail.com", "kitchen", env)).allowed).toBe(false);
    expect((await accessFor(undefined, "kitchen", env)).allowed).toBe(false);
  });

  it("fails closed for anyone Home's list doesn't have, even with an empty list", async () => {
    answer([]);
    expect((await accessFor("sam.cook@gmail.com", "kitchen", env)).allowed).toBe(false);
  });

  it("matches Gmail the way Gmail does: no dots, no plus tags, any case", () => {
    expect(ownerKey("s.a.m+x@gmail.com")).toBe("sam@gmail.com");
    expect(ownerKey("Sam.Cook+kitchen@googlemail.com")).toBe("samcook@gmail.com");
  });

  it("keeps dots meaningful outside Gmail", () => {
    expect(ownerKey("first.last@example.com")).toBe("first.last@example.com");
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

  it("reads the Google photo and name, and only a photo from Google's photo host", async () => {
    const pic = "https://lh3.googleusercontent.com/a/abc=s96-c";
    expect(await verifyAccessJwt(await token({ custom: { picture: pic, name: " Sam Cook " } }), env)).toEqual({
      email: "sam.cook@gmail.com",
      name: "Sam Cook",
      picture: pic,
    });
    const odd = await verifyAccessJwt(await token({ custom: { picture: "https://evil.example/x.png" } }), env);
    expect(odd?.picture).toBeUndefined();
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
