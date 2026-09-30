import type { APIRoute } from "astro";

/** Uploaded photos, streamed from R2 — behind sign-in like every other page. */
export const GET: APIRoute = async ({ params, locals }) => {
  const object = await locals.runtime.env.PHOTOS.get(params.key ?? "");
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      // Keys are unique per upload, so a photo never changes under its URL.
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
};
