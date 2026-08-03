import { databaseSchema, type ShortflareDatabase } from "@shortflare/database/d1";
import { and, eq, exists, gt, isNull, notExists, sql } from "drizzle-orm";

import type { InitialSetupPersistence } from "../../application/initial-setup";
import { first, toDate } from "./shared";

export function createD1InitialSetupPersistence(
  database: ShortflareDatabase,
): InitialSetupPersistence {
  const activeAdministrator = database
    .select({ value: sql`1` })
    .from(databaseSchema.users)
    .where(
      and(eq(databaseSchema.users.state, "active"), eq(databaseSchema.users.role, "administrator")),
    );

  return {
    async isAvailable() {
      const result = first(
        await database
          .select({
            setupCompletedAt: databaseSchema.instances.setupCompletedAt,
            hasActiveAdministrator: exists(activeAdministrator),
          })
          .from(databaseSchema.instances)
          .where(eq(databaseSchema.instances.singletonKey, 1))
          .limit(1),
      );
      return Boolean(result && result.setupCompletedAt === null && !result.hasActiveAdministrator);
    },
    async write(input) {
      const setupAvailable = and(
        eq(databaseSchema.instances.singletonKey, 1),
        isNull(databaseSchema.instances.setupCompletedAt),
        notExists(activeAdministrator),
      );
      await database.batch([
        database.delete(databaseSchema.initialSetup).where(
          and(
            eq(databaseSchema.initialSetup.singletonKey, 1),
            exists(
              database
                .select({ value: sql`1` })
                .from(databaseSchema.instances)
                .where(setupAvailable),
            ),
          ),
        ),
        database.insert(databaseSchema.initialSetup).select(
          database
            .select({
              singletonKey: sql<number>`1`.as("singleton_key"),
              displayEmail: sql<string>`${input.displayEmail}`.as("display_email"),
              normalizedEmail: sql<string>`${input.normalizedEmail}`.as("normalized_email"),
              tokenHash: sql<string>`${input.tokenHash}`.as("token_hash"),
              createdAt: sql<Date>`${input.createdAt}`.as("created_at"),
              expiresAt: sql<Date>`${input.expiresAt}`.as("expires_at"),
            })
            .from(databaseSchema.instances)
            .where(setupAvailable),
        ),
      ]);
    },
    async find(tokenHash, occurredAt) {
      return first(
        await database
          .select({
            displayEmail: databaseSchema.initialSetup.displayEmail,
            normalizedEmail: databaseSchema.initialSetup.normalizedEmail,
          })
          .from(databaseSchema.initialSetup)
          .where(
            and(
              eq(databaseSchema.initialSetup.singletonKey, 1),
              eq(databaseSchema.initialSetup.tokenHash, tokenHash),
              gt(databaseSchema.initialSetup.expiresAt, toDate(occurredAt)),
            ),
          )
          .limit(1),
      );
    },
    async complete(input) {
      // ADR-0007 requires one atomic handoff consumption: the first Administrator,
      // credential, completion marker, and Audit Event either all commit or none do.
      try {
        await database.batch([
          database
            .delete(databaseSchema.initialSetup)
            .where(
              and(
                eq(databaseSchema.initialSetup.singletonKey, 1),
                eq(databaseSchema.initialSetup.tokenHash, input.tokenHash),
                gt(databaseSchema.initialSetup.expiresAt, toDate(input.occurredAt)),
              ),
            ),
          database.insert(databaseSchema.users).values({
            id: input.userId,
            displayEmail: input.displayEmail,
            normalizedEmail: input.normalizedEmail,
            state: "active",
            role: "administrator",
            activatedAt: toDate(input.occurredAt),
            createdAt: toDate(input.occurredAt),
            updatedAt: toDate(input.occurredAt),
          }),
          database.insert(databaseSchema.credentials).values({
            userId: input.userId,
            verifier: input.verifier,
            updatedAt: toDate(input.occurredAt),
          }),
          database
            .update(databaseSchema.instances)
            .set({ setupCompletedAt: toDate(input.occurredAt) })
            .where(
              and(
                eq(databaseSchema.instances.singletonKey, 1),
                isNull(databaseSchema.instances.setupCompletedAt),
              ),
            ),
          database.insert(databaseSchema.auditEvents).values({
            id: input.auditId,
            actorId: "system",
            action: "initial-administrator-activate",
            subjectId: input.userId,
            occurredAt: toDate(input.occurredAt),
            metadata: { toRole: "administrator", toUserState: "active" },
          }),
        ]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
