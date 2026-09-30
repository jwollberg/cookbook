/**
 * Enumerations shared by the schemas and the UI. Kept apart from schema.ts
 * so browser code can use them without pulling zod into every page.
 */

export const AISLES = [
  "produce",
  "meat",
  "seafood",
  "dairy",
  "bakery",
  "pantry",
  "spices",
  "frozen",
  "other",
] as const;
export type Aisle = (typeof AISLES)[number];

export const ROLES = ["main", "side", "starter", "dessert", "drink", "sauce"] as const;
export type Role = (typeof ROLES)[number];

export const SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Slot = (typeof SLOTS)[number];
