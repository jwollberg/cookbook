/**
 * The local stand-in account the dev server signs you in as. Cloudflare
 * Access only exists in production; `import.meta.env.DEV` is replaced with
 * `false` at build time, so this account cannot exist in a deployed Worker.
 */
export const DEV_USER = {
  id: "dev",
  email: "dev@localhost",
  name: "Dev Cook",
  picture: null,
} as const;
