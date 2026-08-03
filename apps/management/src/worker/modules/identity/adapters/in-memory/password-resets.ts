import type { PasswordResetPersistence } from "../../application/password-resets";
import type { User } from "../../application/shared";

export function createInMemoryPasswordResetPersistence(
  seed: readonly User[],
): PasswordResetPersistence {
  const users = new Map(seed.map((user) => [user.id, structuredClone(user)]));
  const resets = new Map<string, Readonly<{ expiresAt: number; tokenHash: string }>>();

  return {
    async findUser(userId) {
      return users.get(userId) ?? null;
    },
    async issue(input) {
      resets.set(input.userId, { expiresAt: input.expiresAt, tokenHash: input.tokenHash });
    },
    async findActiveUserByToken(tokenHash, occurredAt) {
      for (const [userId, reset] of resets) {
        const user = users.get(userId);
        if (
          reset.tokenHash === tokenHash &&
          reset.expiresAt > occurredAt &&
          user?.state === "active"
        ) {
          return user;
        }
      }
      return null;
    },
    async use(input) {
      const reset = resets.get(input.userId);
      if (!reset || reset.tokenHash !== input.tokenHash || reset.expiresAt <= input.occurredAt) {
        return false;
      }
      resets.delete(input.userId);
      return true;
    },
  };
}
