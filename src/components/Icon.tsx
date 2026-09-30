/**
 * The icon set: simple 24px stroke drawings, inline so they inherit colour
 * and cost no requests. Usable from Astro (rendered to static SVG) and from
 * islands alike.
 */

const PATHS = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </>
  ),
  book: (
    <>
      <path d="M6 4h11.5a.5.5 0 0 1 .5.5V20H7.5A2.5 2.5 0 0 1 5 17.5V5a1 1 0 0 1 1-1z" />
      <path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H18" />
    </>
  ),
  cloche: (
    <>
      <path d="M3.5 17.5h17" />
      <path d="M5.5 17.5a6.5 6.5 0 0 1 13 0" />
      <path d="M12 8.5V6.5M10 6.5h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  bag: (
    <>
      <path d="M5.5 8.5h13l-1 11.5h-11z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </>
  ),
  pot: (
    <>
      <path d="M4.5 10.5h15V16a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4z" />
      <path d="M2.5 10.5h19" />
      <path d="M9.5 7c0-1.2 1.2-1.3 1.2-2.5M14.3 7c0-1.2 1.2-1.3 1.2-2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M21.5 20a6.5 6.5 0 0 0-4-6" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4.5L19.5 9a2.1 2.1 0 0 0-3-3L5.5 17z" />
      <path d="m14.5 7.5 3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3.2l1.8-2.5h6L16.8 8H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  printer: (
    <>
      <path d="M7 9V3.5h10V9" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="m10 16-4-4 4-4M6 12h10" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="7" r="1.2" fill="currentColor" />
      <circle cx="15" cy="7" r="1.2" fill="currentColor" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" />
      <circle cx="9" cy="17" r="1.2" fill="currentColor" />
      <circle cx="15" cy="17" r="1.2" fill="currentColor" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4.5M7 9.5l5-5 5 5M5 20h14" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.5" cy="6.5" r="1" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" />
      <circle cx="4.5" cy="17.5" r="1" fill="currentColor" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Google's "G", for the sign-in button (their brand guidelines ask for the official mark). */
export function GoogleMark() {
  return (
    <svg className="icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
