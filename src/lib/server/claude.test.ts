/**
 * The shared Claude helper: each app signs its own fresh JWT for every exchange, AI is off until
 * the settings are all there, usage is counted per person and forgotten with them, and the
 * monthly cap stops the asking. No call reaches Anthropic: its endpoints are faked.
 */

import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { AI_USAGE_SQL, ClaudeError, aiUsage, appSpendCents, ask, capCents, claudeReady, forgetAiUsage, resetClaude, signIdentityJwt, wifSettings, type ClaudeApp } from "./claude";
import { openD1 } from "./d1";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const dir = mkdtempSync(join(tmpdir(), "claude-"));
const keyFile = join(dir, "claude-wif.key");
writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(join(dir, "0001_ai_usage.sql"), AI_USAGE_SQL);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  resetClaude();
});

const env = {
  ANTHROPIC_ORGANIZATION_ID: "62126109-ee75-47a4-840b-6241d6473261",
  ANTHROPIC_FEDERATION_RULE_ID: "fdrl_rule",
  ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_account",
  CLAUDE_WIF_KEY_FILE: keyFile,
};

const app = (more: Record<string, string> = {}): ClaudeApp => ({
  id: "kitchen",
  name: "Hestia",
  env: { ...env, ...more },
  db: openD1(":memory:", dir),
});

const parts = (jwt: string) => {
  const [h, c, s] = jwt.split(".");
  const json = (p: string) => JSON.parse(Buffer.from(p, "base64url").toString());
  return { header: json(h), claims: json(c), signed: `${h}.${c}`, s };
};

/** Anthropic as the SDK sees it: the token exchange, then Messages answering `reply`. */
function fakeAnthropic(reply: { text: string; input: number; output: number; stop?: string }) {
  const seen = { assertions: [] as string[], messages: [] as Record<string, unknown>[] };
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (u.endsWith("/v1/oauth/token")) {
      seen.assertions.push(body.assertion);
      return Response.json({ access_token: `sk-ant-oat01-${seen.assertions.length}`, token_type: "Bearer", expires_in: 598 });
    }
    seen.messages.push(body);
    return Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: reply.text }],
      stop_reason: reply.stop ?? "end_turn",
      stop_sequence: null,
      usage: { input_tokens: reply.input, output_tokens: reply.output },
    });
  });
  return seen;
}

describe("an app's identity for Claude", () => {
  it("signs an RS256 JWT as its own issuer, which its public key verifies", () => {
    const { header, claims, signed, s } = parts(signIdentityJwt("kitchen", privateKey, 1_800_000_000));
    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: "kitchen-1" });
    expect(claims).toMatchObject({
      iss: "https://vault.atheos.internal/kitchen",
      sub: "kitchen",
      aud: "https://api.anthropic.com",
      iat: 1_800_000_000,
      nbf: 1_799_999_995,
      exp: 1_800_000_300,
    });
    expect(createVerify("RSA-SHA256").update(signed).verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("matches Techne's, so Techne can move onto this helper unchanged", () => {
    const { header, claims } = parts(signIdentityJwt("techne", privateKey));
    expect(header.kid).toBe("techne-1");
    expect(claims).toMatchObject({ iss: "https://vault.atheos.internal/techne", sub: "techne" });
  });

  it("is off until every setting is there, or when the cap is 0", () => {
    expect(wifSettings(env)).not.toBeNull();
    expect(claudeReady(env)).toBe(true);
    expect(claudeReady({ ...env, CLAUDE_WIF_KEY_FILE: "" })).toBe(false);
    expect(claudeReady({ ...env, ANTHROPIC_FEDERATION_RULE_ID: undefined })).toBe(false);
    expect(claudeReady({ ...env, AI_MONTHLY_CAP_CENTS: "0" })).toBe(false);
    expect(capCents(env)).toBe(200);
    expect(capCents({ AI_MONTHLY_CAP_CENTS: "50" })).toBe(50);
    expect(capCents({ AI_MONTHLY_CAP_CENTS: "lots" })).toBe(200);
  });
});

describe("asking", () => {
  it("signs a new JWT for the exchange and asks the quick model at low effort", async () => {
    const a = app();
    const seen = fakeAnthropic({ text: " Chicken soup ", input: 1000, output: 100 });
    expect(await ask(a, "josh@gmail.com", { job: "quick", system: "Name the dish.", content: "broth, chicken, noodles" })).toBe("Chicken soup");
    expect(seen.assertions).toHaveLength(1);
    expect(parts(seen.assertions[0]).claims.sub).toBe("kitchen");
    expect(seen.messages[0]).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low" }, system: "Name the dish." });
  });

  it("answers in the schema's shape", async () => {
    const a = app();
    fakeAnthropic({ text: JSON.stringify({ title: "Soup", minutes: 40 }), input: 10, output: 10 });
    const out = await ask(a, "josh@gmail.com", { job: "careful", system: "Read it.", content: "…", schema: z.object({ title: z.string(), minutes: z.number() }) });
    expect(out).toEqual({ title: "Soup", minutes: 40 });
  });

  it("counts each call against its person, and forgets them with their data", async () => {
    const a = app();
    fakeAnthropic({ text: "ok", input: 1_000_000, output: 0 });
    await ask(a, "josh@gmail.com", { job: "quick", system: "s", content: "c" });
    await ask(a, "josh@gmail.com", { job: "quick", system: "s", content: "c" });
    await ask(a, "pat@gmail.com", { job: "quick", system: "s", content: "c" });
    expect(await aiUsage(a.db, "josh@gmail.com")).toMatchObject({ calls: 2, cents: 20 });
    expect(await aiUsage(a.db, "pat@gmail.com")).toMatchObject({ calls: 1, cents: 10 });
    expect(await appSpendCents(a.db)).toBe(30);
    await forgetAiUsage(a.db, "pat@gmail.com");
    expect(await aiUsage(a.db, "pat@gmail.com")).toMatchObject({ calls: 0, cents: 0 });
    expect(await aiUsage(a.db, "josh@gmail.com")).toMatchObject({ calls: 2 });
  });

  it("stops at the month's cap, everyone's spend together, without asking Claude", async () => {
    const a = app({ AI_MONTHLY_CAP_CENTS: "25" });
    const seen = fakeAnthropic({ text: "ok", input: 0, output: 300_000 });
    await ask(a, "josh@gmail.com", { job: "quick", system: "s", content: "c" });
    await ask(a, "pat@gmail.com", { job: "quick", system: "s", content: "c" });
    await expect(ask(a, "josh@gmail.com", { job: "quick", system: "s", content: "c" })).rejects.toThrow(/Hestia's AI allowance for this month is used up/);
    expect(seen.messages).toHaveLength(2);
  });

  it("says in words when Claude refuses, and still counts the call", async () => {
    const a = app();
    fakeAnthropic({ text: "", input: 50, output: 0, stop: "refusal" });
    const asked = ask(a, "josh@gmail.com", { job: "quick", system: "s", content: "c" });
    await expect(asked).rejects.toBeInstanceOf(ClaudeError);
    await expect(asked).rejects.toThrow("Claude wouldn't help with that one.");
    expect((await aiUsage(a.db, "josh@gmail.com")).calls).toBe(1);
  });

  it("refuses when the sign-in isn't set up", async () => {
    await expect(ask(app({ CLAUDE_WIF_KEY_FILE: "" }), "josh@gmail.com", { job: "quick", system: "s", content: "c" })).rejects.toThrow(/isn't set up/);
  });
});
