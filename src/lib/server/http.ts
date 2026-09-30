/**
 * Small helpers for the JSON API routes.
 */

import type { ZodType } from "zod";
import { ConflictError } from "./db";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function fail(status: number, error: string): Response {
  return json({ error }, status);
}

export class BadRequest extends Error {}

/** Parse and validate a JSON body, or throw a BadRequest a person can read. */
export async function readBody<T>(request: Request, schema: ZodType<T, any, any>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new BadRequest("Expected a JSON body.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BadRequest(issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request.");
  }
  return parsed.data;
}

/** Map thrown errors to responses, so every route reports failures the same way. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BadRequest) return fail(400, error.message);
    if (error instanceof ConflictError) return fail(409, error.message);
    console.error(error);
    return fail(500, "Something went wrong on the server.");
  }
}
