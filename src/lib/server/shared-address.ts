/**
 * Hestia on the address every app shares, oikos.atheosstudios.com/hestia (plan-one-address-one-app,
 * step 15; security.ts says why): the Content-Security-Policy on every answer, and which writes the
 * middleware refuses. Kept out of src/middleware.ts so vitest can load it.
 */

import menuJs from "../menu.js?raw";
import themeJs from "../theme.js?raw";
import { BASE } from "../base";
import { contentSecurityPolicy, fromOwnPage, isWrite } from "./security";

/** The inline scripts SiteLayout puts in every page's <head>; everything else runs from Hestia's own files. */
export const INLINE = [themeJs, menuJs];

/**
 * Outside addresses the pages load: the signed-in person's Google picture in the account menu
 * (access.ts takes only lh3.googleusercontent.com). Recipe photos are Hestia's own (/images/,
 * /photos/), and a recipe from a link is fetched by the server, never the browser.
 */
export const EXTRAS = { img: ["https://lh3.googleusercontent.com"] };

export const POLICY = contentSecurityPolicy(INLINE, EXTRAS);

/** Machine doors, checked by their own keys: Oikos's calls to /internal/ (INTERNAL_TOKEN). */
const DOORS = ["/internal/"];

/** Whether a write must be refused: not from one of Hestia's own pages, and not a machine door. */
export const refusesWrite = (request: Request, routePath: string, base: string = BASE) =>
  isWrite(request.method) && !DOORS.some((d) => routePath.startsWith(d)) && !fromOwnPage(request, base);
