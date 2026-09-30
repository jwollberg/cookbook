/**
 * Ids. Recipes and ingredients are keyed by a kebab-case slug made from
 * their name, which keeps ids readable in URLs and in the data.
 */

/** Kebab-case slug matching the schema's id pattern. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Append -2, -3 … until the slug is free. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const existing = new Set(taken);
  const slug = slugify(base) || "untitled";
  if (!existing.has(slug)) return slug;
  let n = 2;
  while (existing.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}
