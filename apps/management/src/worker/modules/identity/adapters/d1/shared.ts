import { databaseSchema } from "@shortflare/database/d1";

export const userSelection = {
  id: databaseSchema.users.id,
  email: databaseSchema.users.displayEmail,
  role: databaseSchema.users.role,
  state: databaseSchema.users.state,
} as const;

export function first<Row>(rows: readonly Row[]): Row | null {
  return rows[0] ?? null;
}

export function changed(results: readonly unknown[], index: number): boolean {
  const result = results[index] as D1Result | undefined;
  return (result?.meta.changes ?? 0) > 0;
}

export function toDate(timestamp: number): Date {
  return new Date(timestamp);
}
