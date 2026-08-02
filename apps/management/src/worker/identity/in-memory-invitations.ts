import type { InvitationPersistence } from "./invitations";
import type { User } from "./shared";

type Invitation = Readonly<{
  expiresAt: number;
  tokenHash: string;
  userId: string;
}>;

export function createInMemoryInvitationPersistence(): InvitationPersistence {
  const users = new Map<string, User>();
  const normalizedEmails = new Map<string, string>();
  const invitations = new Map<string, Invitation>();

  return {
    async findUserByNormalizedEmail(normalizedEmail) {
      const userId = normalizedEmails.get(normalizedEmail);
      return userId === undefined ? null : (users.get(userId) ?? null);
    },

    async issue(input) {
      const current = input.existing ?? users.get(input.userId);
      if (current?.state === "active" || current?.state === "suspended") return false;

      const user: User = {
        id: input.userId,
        email: input.displayEmail,
        role: input.role,
        state: "invited",
      };
      users.set(user.id, user);
      normalizedEmails.set(input.normalizedEmail, user.id);
      invitations.set(user.id, {
        expiresAt: input.expiresAt,
        tokenHash: input.tokenHash,
        userId: user.id,
      });
      return true;
    },

    async findInvitedUser(tokenHash, occurredAt) {
      const invitation = [...invitations.values()].find(
        (candidate) => candidate.tokenHash === tokenHash && candidate.expiresAt > occurredAt,
      );
      if (!invitation) return null;
      const user = users.get(invitation.userId);
      return user?.state === "invited" ? user : null;
    },

    async accept(input) {
      const invitation = invitations.get(input.userId);
      const user = users.get(input.userId);
      if (!invitation || invitation.tokenHash !== input.tokenHash || user?.state !== "invited") {
        return false;
      }
      invitations.delete(input.userId);
      users.set(input.userId, { ...user, state: "active" });
      return true;
    },

    async cancel(input) {
      const user = users.get(input.userId);
      if (user?.state !== "invited") return false;
      users.delete(input.userId);
      invitations.delete(input.userId);
      return true;
    },
  };
}
