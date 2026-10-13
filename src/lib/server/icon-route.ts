/**
 * Kitchen's icons at its root (/apple-touch-icon.png, /favicon.svg, …), as Home draws them from
 * the app list (apps.ts, `homeIcon`): change the icon or color in Home's apps.json and these follow.
 */

import type { APIRoute } from "astro";
import { homeIcon } from "./apps";

export const GET: APIRoute = ({ url }) => homeIcon(process.env, "kitchen", url.pathname.slice(1));
