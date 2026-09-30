import type { APIRoute } from "astro";

/** Everything is behind sign-in; there is nothing for a crawler to find. */
export const GET: APIRoute = () =>
  new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
