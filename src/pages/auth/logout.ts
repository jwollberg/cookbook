import type { APIRoute } from "astro";
import { clearSession } from "../../lib/server/auth";

/** POST only, so a link on some other site cannot sign you out. */
export const POST: APIRoute = ({ url, cookies, redirect }) => {
  clearSession(cookies, url);
  return redirect("/login?signed-out=1");
};
