/**
 * The sign-in gate. Every one of these failing open would let a stranger
 * into the household's kitchen, so they are tested rather than trusted.
 */

import { describe, it, expect } from "vitest";
import { canonicalEmail, checkClaims, isAllowed, safeNext, type GoogleClaims } from "./auth";
import { sign, unsign, pkceChallenge } from "./crypto";

const LIST = "josh.wollberg@gmail.com, reagen.wollberg@gmail.com gwenevere.greenwood@gmail.com";

describe("allowlist", () => {
  it("admits listed accounts", () => {
    expect(isAllowed("josh.wollberg@gmail.com", LIST)).toBe(true);
    expect(isAllowed("gwenevere.greenwood@gmail.com", LIST)).toBe(true);
  });

  it("matches Gmail the way Gmail does: no dots, no plus tags, any case", () => {
    expect(isAllowed("JoshWollberg@Gmail.com", LIST)).toBe(true);
    expect(isAllowed("josh.wollberg+kitchen@googlemail.com", LIST)).toBe(true);
    expect(canonicalEmail("j.o.s.h+x@gmail.com")).toBe("josh@gmail.com");
  });

  it("keeps dots meaningful outside Gmail", () => {
    expect(canonicalEmail("first.last@example.com")).toBe("first.last@example.com");
    expect(isAllowed("joshwollberg@example.com", "josh.wollberg@example.com")).toBe(false);
  });

  it("refuses everyone else", () => {
    expect(isAllowed("someone@gmail.com", LIST)).toBe(false);
    expect(isAllowed(undefined, LIST)).toBe(false);
  });

  it("fails closed when the list is missing or empty", () => {
    expect(isAllowed("josh.wollberg@gmail.com", undefined)).toBe(false);
    expect(isAllowed("josh.wollberg@gmail.com", "  ")).toBe(false);
  });
});

describe("Google ID token claims", () => {
  const CLIENT = "client-123.apps.googleusercontent.com";
  const good = (over: Partial<GoogleClaims> = {}): GoogleClaims => ({
    iss: "https://accounts.google.com",
    aud: CLIENT,
    sub: "1234",
    email: "josh.wollberg@gmail.com",
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...over,
  });

  it("accepts a well-formed token", () => {
    expect(checkClaims(good(), CLIENT)).toBeNull();
    expect(checkClaims(good({ iss: "accounts.google.com" }), CLIENT)).toBeNull();
  });

  it("rejects another app's token, a stranger issuer, an expired token", () => {
    expect(checkClaims(good({ aud: "someone-else" }), CLIENT)).not.toBeNull();
    expect(checkClaims(good({ iss: "https://evil.example" }), CLIENT)).not.toBeNull();
    expect(checkClaims(good({ exp: Math.floor(Date.now() / 1000) - 1 }), CLIENT)).not.toBeNull();
  });

  it("rejects an unverified address — anyone can type an address into a new account", () => {
    expect(checkClaims(good({ email_verified: false }), CLIENT)).not.toBeNull();
    expect(checkClaims(good({ email_verified: undefined }), CLIENT)).not.toBeNull();
  });
});

describe("signed tokens", () => {
  const SECRET = "test-secret";

  it("round-trips a payload", async () => {
    const token = await sign({ uid: "u1", exp: Date.now() + 1000 }, SECRET);
    expect(await unsign<{ uid: string; exp: number }>(token, SECRET)).toMatchObject({ uid: "u1" });
  });

  it("rejects a tampered payload", async () => {
    const token = await sign({ uid: "u1", exp: Date.now() + 1000 }, SECRET);
    const [, sig] = token.split(".");
    const forged = `${btoa(JSON.stringify({ uid: "admin", exp: Date.now() + 1000 })).replace(/=+$/, "")}.${sig}`;
    expect(await unsign(forged, SECRET)).toBeNull();
  });

  it("rejects the wrong secret, an expired token, and junk", async () => {
    const token = await sign({ uid: "u1", exp: Date.now() + 1000 }, SECRET);
    expect(await unsign(token, "other-secret")).toBeNull();
    const old = await sign({ uid: "u1", exp: Date.now() - 1 }, SECRET);
    expect(await unsign(old, SECRET)).toBeNull();
    expect(await unsign("not-a-token", SECRET)).toBeNull();
    expect(await unsign(undefined, SECRET)).toBeNull();
    expect(await unsign(token, undefined)).toBeNull();
  });

  it("computes the RFC 7636 PKCE challenge", async () => {
    // The worked example from RFC 7636, appendix B.
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
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
    expect(safeNext("/login")).toBe("/");
    expect(safeNext("/auth/callback")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
