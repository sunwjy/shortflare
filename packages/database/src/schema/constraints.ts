import { sql } from "drizzle-orm";

export const idCheck = (column: { getSQL(): unknown }) => sql`length(${column}) BETWEEN 1 AND 128`;

export const timestampCheck = (column: { getSQL(): unknown }) =>
  sql`typeof(${column}) = 'integer' AND ${column} >= 0`;
