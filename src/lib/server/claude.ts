/**
 * Claude for an Atheos app: one way for every app to ask (plan-claude-in-the-atheos-apps in
 * Telos, lifted from Techne's ai.ts and wif.ts). Claude only drafts and suggests; a person
 * saves, sorts, approves or sends. Only the signed-in person's own data goes in, picked by the
 * app's data layer, and photos are shrunk before they come here.
 *
 * Sign-in is Workload Identity Federation, never an API key: the app is its own small issuer
 * (`iss` https://vault.atheos.internal/<id>, subject <id>, kid <id>-1) and signs a fresh
 * five-minute JWT with its private key on Vault (CLAUDE_WIF_KEY_FILE) for every exchange, since
 * a jti works once; Anthropic trades it for a ten-minute token. Its public half is pasted into
 * Claude's Console as the issuer's inline JWKS (vault/README.md, Claude's sign-in). Without the
 * settings, `claudeReady` is false and the app hides its AI buttons.
 *
 * Every call is counted per person, month and model in the app's `ai_usage` table, and the app
 * stops asking once the month's spend reaches AI_MONTHLY_CAP_CENTS (200 unless set; 0 turns AI
 * off): the risk is a bug that asks in a loop, not Josh. `forgetAiUsage` is for /internal/forget.
 * AI_FAKE=1 (the dev server only) answers with each question's `fake`, without Claude.
 *
 * This is the canonical copy (vault/README.md, The apps' platform). Each app carries a copy at
 * src/lib/server/claude.ts. It needs `@anthropic-ai/sdk` and `zod` (3.25 or later, for zod/v4).
 */

import { createPrivateKey, createSign, randomUUID, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";
import type { z } from "zod/v4";
import type { D1Database } from "./d1";

/** Which model does which kind of job: the one place to change it. */
export const MODELS = {
  /** Reading, sorting, a caption, a suggestion. */
  quick: { model: "claude-haiku-5-5", effort: "low" },
  /** Writing someone will read, and judgment. */
  careful: { model: "claude-sonnet-5-5", effort: "medium" },
} as const;
export type Job = keyof typeof MODELS;

/** List prices per million tokens (USD), for the spend estimate and the cap. */
export const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

/** The table each app's migrations make (Techne's shape). */
export const AI_USAGE_SQL = `CREATE TABLE ai_usage (
  owner TEXT NOT NULL,
  month TEXT NOT NULL,
  model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, month, model)
);`;

export interface ClaudeEnv {
  ANTHROPIC_ORGANIZATION_ID?: string;
  ANTHROPIC_FEDERATION_RULE_ID?: string;
  ANTHROPIC_SERVICE_ACCOUNT_ID?: string;
  /** Only when the rule covers more than one workspace. */
  ANTHROPIC_WORKSPACE_ID?: string;
  CLAUDE_WIF_KEY_FILE?: string;
  AI_MONTHLY_CAP_CENTS?: string;
  AI_FAKE?: string;
}

/** The app asking: its id (as in apps.json, which names its issuer), its name for messages, its settings and database. */
export interface ClaudeApp {
  id: string;
  name: string;
  env: ClaudeEnv;
  db: D1Database;
}

/** Something to tell the person, in words: Claude is busy, said no, or the month's allowance is used. */
export class ClaudeError extends Error {}

// ---- Sign-in ----

export const WIF_AUDIENCE = "https://api.anthropic.com";
const JWT_LIFETIME_S = 300;

export const wifIssuer = (id: string) => `https://vault.atheos.internal/${id}`;
export const wifKid = (id: string) => `${id}-1`;

export interface WifSettings {
  organizationId: string;
  federationRuleId: string;
  serviceAccountId: string;
  workspaceId?: string;
  keyFile: string;
}

/** The settings from app.env, or null when any is missing (then AI is off). */
export function wifSettings(env: ClaudeEnv): WifSettings | null {
  const organizationId = env.ANTHROPIC_ORGANIZATION_ID?.trim();
  const federationRuleId = env.ANTHROPIC_FEDERATION_RULE_ID?.trim();
  const serviceAccountId = env.ANTHROPIC_SERVICE_ACCOUNT_ID?.trim();
  const keyFile = env.CLAUDE_WIF_KEY_FILE?.trim();
  if (!organizationId || !federationRuleId || !serviceAccountId || !keyFile) return null;
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim() || undefined;
  return { organizationId, federationRuleId, serviceAccountId, keyFile, ...(workspaceId ? { workspaceId } : {}) };
}

const b64url = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/** A fresh RS256 JWT asserting the app's identity, for one token exchange. */
export function signIdentityJwt(id: string, signingKey: KeyObject, now = Math.floor(Date.now() / 1000)): string {
  const header = { alg: "RS256", typ: "JWT", kid: wifKid(id) };
  const claims = { iss: wifIssuer(id), sub: id, aud: WIF_AUDIENCE, iat: now, nbf: now - 5, exp: now + JWT_LIFETIME_S, jti: randomUUID() };
  const unsigned = `${b64url(header)}.${b64url(claims)}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(signingKey).toString("base64url")}`;
}

const keys = new Map<string, KeyObject>();

function privateKey(file: string): KeyObject {
  let key = keys.get(file);
  if (!key) keys.set(file, (key = createPrivateKey(readFileSync(file, "utf8"))));
  return key;
}

const clients = new Map<string, Anthropic>();

/** One client per app and settings; its token cache exchanges a fresh JWT before each token runs out. */
export function claudeClient(id: string, env: ClaudeEnv): Anthropic {
  const s = wifSettings(env);
  if (!s) throw new ClaudeError("AI isn't set up yet (Claude's sign-in isn't configured on the server).");
  const key = JSON.stringify([id, s]);
  let client = clients.get(key);
  if (!client) {
    client = new Anthropic({
      apiKey: null,
      authToken: null,
      credentials: oidcFederationProvider({
        identityTokenProvider: () => signIdentityJwt(id, privateKey(s.keyFile)),
        federationRuleId: s.federationRuleId,
        organizationId: s.organizationId,
        serviceAccountId: s.serviceAccountId,
        workspaceId: s.workspaceId,
        baseURL: "https://api.anthropic.com",
        fetch,
      }),
      timeout: 60_000,
      maxRetries: 2,
    });
    clients.set(key, client);
  }
  return client;
}

/** For tests: forget the clients and keys, so the next ask builds them again. */
export function resetClaude(): void {
  clients.clear();
  keys.clear();
}

// ---- When AI is on ----

const fake = (env: ClaudeEnv) => import.meta.env?.DEV === true && env.AI_FAKE === "1";

/** The monthly cap in cents: AI_MONTHLY_CAP_CENTS, or 200. */
export function capCents(env: ClaudeEnv): number {
  const raw = env.AI_MONTHLY_CAP_CENTS?.trim();
  const n = raw ? Number(raw) : 200;
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

/** Whether the app shows its AI buttons: the sign-in is set up and the cap isn't 0 (or the dev server's fake is on). */
export const claudeReady = (env: ClaudeEnv): boolean => fake(env) || (wifSettings(env) !== null && capCents(env) > 0);

// ---- Usage and the cap ----

const thisMonth = () => new Date().toISOString().slice(0, 7);

interface UsageRow {
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

function cents(rows: UsageRow[]): number {
  let dollars = 0;
  for (const r of rows) {
    const p = PRICE_PER_M[r.model] ?? PRICE_PER_M["claude-sonnet-5-5"];
    dollars += (r.input_tokens * p.input + r.output_tokens * p.output) / 1_000_000;
  }
  return Math.round(dollars * 10000) / 100;
}

async function count(db: D1Database, owner: string, model: string, usage: { input_tokens: number; output_tokens: number } | undefined) {
  await db
    .prepare(
      `INSERT INTO ai_usage (owner, month, model, calls, input_tokens, output_tokens) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT (owner, month, model) DO UPDATE SET calls = calls + 1,
         input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`,
    )
    .bind(owner, thisMonth(), model, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0)
    .run();
}

/** One person's AI use in a month, and its cost in cents (an estimate from the list prices). */
export async function aiUsage(db: D1Database, owner: string, month = thisMonth()) {
  const { results } = await db
    .prepare("SELECT model, calls, input_tokens, output_tokens FROM ai_usage WHERE owner = ? AND month = ?")
    .bind(owner, month)
    .all<UsageRow>();
  return { month, calls: results.reduce((s, r) => s + r.calls, 0), cents: cents(results) };
}

/** Everyone's AI spend in the app this month, in cents: what the cap is checked against. */
export async function appSpendCents(db: D1Database, month = thisMonth()): Promise<number> {
  const { results } = await db
    .prepare("SELECT model, SUM(calls) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM ai_usage WHERE month = ? GROUP BY model")
    .bind(month)
    .all<UsageRow>();
  return cents(results);
}

/** For /internal/forget: that person's usage rows go with the rest of their data. */
export async function forgetAiUsage(db: D1Database, owner: string): Promise<void> {
  await db.prepare("DELETE FROM ai_usage WHERE owner = ?").bind(owner).run();
}

// ---- Asking ----

export interface Question {
  job: Job;
  system: string;
  /** The person's words, or content blocks (an image goes before its text). */
  content: string | Anthropic.ContentBlockParam[];
  maxTokens?: number;
  /** What the dev server's fake answers. */
  fake?: unknown;
}

/** Claude's errors in words for the person, never its raw response. */
function inWords(app: ClaudeApp, error: unknown): ClaudeError {
  if (error instanceof ClaudeError) return error;
  if (error instanceof Anthropic.RateLimitError) return new ClaudeError("Claude is busy right now. Try again in a minute.");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ClaudeError(`Claude didn't accept ${app.name}'s sign-in. Its Workload Identity settings need checking.`);
  }
  if (error instanceof Anthropic.APIError) return new ClaudeError(`Claude said no (${error.status ?? "no answer"}).`);
  return new ClaudeError(`Couldn't reach Claude: ${error instanceof Error ? error.message : error}`);
}

/**
 * Asks Claude one question for one person and answers with its draft: text, or with `schema`,
 * an object of that shape. Counted against the person and the app's monthly cap.
 */
export async function ask<S extends z.ZodType>(app: ClaudeApp, owner: string, q: Question & { schema: S; fake?: z.infer<S> }): Promise<z.infer<S>>;
export async function ask(app: ClaudeApp, owner: string, q: Question & { schema?: undefined; fake?: string }): Promise<string>;
export async function ask(app: ClaudeApp, owner: string, q: Question & { schema?: z.ZodType }): Promise<unknown> {
  if (fake(app.env)) {
    if (q.fake === undefined) throw new ClaudeError("This question has no fake answer for the dev server.");
    return q.fake;
  }
  if (!claudeReady(app.env)) throw new ClaudeError("AI isn't set up yet (Claude's sign-in isn't configured on the server).");
  if ((await appSpendCents(app.db)) >= capCents(app.env)) {
    throw new ClaudeError(`${app.name}'s AI allowance for this month is used up. It starts again on the 1st.`);
  }
  const { model, effort } = MODELS[q.job];
  const request = {
    model,
    max_tokens: q.maxTokens ?? 4000,
    system: q.system,
    messages: [{ role: "user" as const, content: q.content }],
  };
  try {
    const client = claudeClient(app.id, app.env);
    if (q.schema) {
      const response = await client.messages.parse({ ...request, output_config: { effort, format: zodOutputFormat(q.schema) } });
      await count(app.db, owner, model, response.usage);
      if (response.stop_reason === "refusal") throw new ClaudeError("Claude wouldn't help with that one.");
      if (response.parsed_output == null) throw new ClaudeError("Claude's answer didn't come back in the right shape. Try again.");
      return response.parsed_output;
    }
    const response = await client.messages.create({ ...request, output_config: { effort } });
    await count(app.db, owner, model, response.usage);
    if (response.stop_reason === "refusal") throw new ClaudeError("Claude wouldn't help with that one.");
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (!text) throw new ClaudeError("Claude sent back nothing. Try again.");
    return text;
  } catch (error) {
    throw inWords(app, error);
  }
}

/** A JPEG for `content`, already shrunk by the app (900 px on the long side is plenty). */
export const jpegBlock = (jpeg: Uint8Array): Anthropic.ImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(jpeg).toString("base64") },
});
