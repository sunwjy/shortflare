import { databaseSchema, type ShortflareDatabase } from "@shortflare/database/d1";
import { and, eq, gt, sql } from "drizzle-orm";

import type { InvitationPersistence } from "../../application/invitations";
import { changed, first, toDate, userSelection } from "./shared";

export function createD1InvitationPersistence(database: ShortflareDatabase): InvitationPersistence {
  return {
    async findUserByNormalizedEmail(normalizedEmail) {
      return first(
        await database
          .select(userSelection)
          .from(databaseSchema.users)
          .where(eq(databaseSchema.users.normalizedEmail, normalizedEmail))
          .limit(1),
      );
    },

    async issue(input) {
      // Issuing replaces any prior token for this Invited User in the same batch
      // that establishes the User state and records the Audit Event.
      const userWrite = input.existing
        ? database
            .update(databaseSchema.users)
            .set({
              displayEmail: input.displayEmail,
              role: input.role,
              updatedAt: toDate(input.occurredAt),
            })
            .where(
              and(
                eq(databaseSchema.users.id, input.userId),
                eq(databaseSchema.users.state, "invited"),
              ),
            )
        : database.insert(databaseSchema.users).values({
            id: input.userId,
            displayEmail: input.displayEmail,
            normalizedEmail: input.normalizedEmail,
            state: "invited",
            role: input.role,
            activatedAt: null,
            createdAt: toDate(input.occurredAt),
            updatedAt: toDate(input.occurredAt),
          });
      try {
        await database.batch([
          userWrite,
          database
            .delete(databaseSchema.invitations)
            .where(eq(databaseSchema.invitations.userId, input.userId)),
          database.insert(databaseSchema.invitations).values({
            id: input.invitationId,
            userId: input.userId,
            tokenHash: input.tokenHash,
            issuedAt: toDate(input.occurredAt),
            expiresAt: toDate(input.expiresAt),
          }),
          database.insert(databaseSchema.auditEvents).values({
            id: input.auditId,
            actorId: input.actorId,
            action: input.existing ? "invitation-reissue" : "invitation-issue",
            subjectId: input.userId,
            occurredAt: toDate(input.occurredAt),
            metadata: {
              ...(input.existing ? { fromRole: input.existing.role } : {}),
              toRole: input.role,
              toUserState: "invited",
            },
          }),
        ]);
        return true;
      } catch {
        return false;
      }
    },

    async findInvitedUser(tokenHash, occurredAt) {
      return first(
        await database
          .select(userSelection)
          .from(databaseSchema.invitations)
          .innerJoin(
            databaseSchema.users,
            eq(databaseSchema.users.id, databaseSchema.invitations.userId),
          )
          .where(
            and(
              eq(databaseSchema.invitations.tokenHash, tokenHash),
              gt(databaseSchema.invitations.expiresAt, toDate(occurredAt)),
              eq(databaseSchema.users.state, "invited"),
            ),
          )
          .limit(1),
      );
    },

    async accept(input) {
      // Token consumption, credential creation, activation, and its Audit Event
      // are one transition so an Invitation cannot be partially accepted.
      try {
        const results = await database.batch([
          database
            .delete(databaseSchema.invitations)
            .where(
              and(
                eq(databaseSchema.invitations.userId, input.userId),
                eq(databaseSchema.invitations.tokenHash, input.tokenHash),
              ),
            ),
          database.insert(databaseSchema.credentials).values({
            userId: input.userId,
            verifier: input.verifier,
            updatedAt: toDate(input.occurredAt),
          }),
          database
            .update(databaseSchema.users)
            .set({
              state: "active",
              activatedAt: toDate(input.occurredAt),
              updatedAt: toDate(input.occurredAt),
            })
            .where(
              and(
                eq(databaseSchema.users.id, input.userId),
                eq(databaseSchema.users.state, "invited"),
              ),
            ),
          database.insert(databaseSchema.auditEvents).values({
            id: input.auditId,
            actorId: input.userId,
            action: "invitation-accept",
            subjectId: input.userId,
            occurredAt: toDate(input.occurredAt),
            metadata: { fromUserState: "invited", toUserState: "active" },
          }),
        ]);
        return changed(results, 2);
      } catch {
        return false;
      }
    },

    async cancel(input) {
      const results = await database.batch([
        database.insert(databaseSchema.auditEvents).select(
          database
            .select({
              id: sql<string>`${input.auditId}`.as("id"),
              actorId: sql<string>`${input.actorId}`.as("actor_id"),
              action: sql<"invitation-cancel">`${"invitation-cancel"}`.as("action"),
              subjectId: databaseSchema.users.id,
              occurredAt: sql<Date>`${input.occurredAt}`.as("occurred_at"),
              metadata: sql<{ fromUserState: "invited" }>`${JSON.stringify({
                fromUserState: "invited",
              })}`.as("metadata"),
            })
            .from(databaseSchema.users)
            .where(
              and(
                eq(databaseSchema.users.id, input.userId),
                eq(databaseSchema.users.state, "invited"),
              ),
            ),
        ),
        database
          .delete(databaseSchema.users)
          .where(
            and(
              eq(databaseSchema.users.id, input.userId),
              eq(databaseSchema.users.state, "invited"),
            ),
          ),
      ]);
      return changed(results, 1);
    },
  };
}
