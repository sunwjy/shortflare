import { drizzle } from "drizzle-orm/d1";

import * as databaseSchema from "./schema";

export { databaseSchema };

export function createD1Database(database: D1Database) {
  return drizzle(database, { schema: databaseSchema });
}

export type ShortflareDatabase = ReturnType<typeof createD1Database>;
