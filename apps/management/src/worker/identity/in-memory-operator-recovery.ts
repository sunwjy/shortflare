import type { OperatorRecoveryPersistence } from "./operator-recovery";
import type { User } from "./shared";

export function createInMemoryOperatorRecoveryPersistence(
  seed: readonly User[],
): OperatorRecoveryPersistence {
  const users = new Map(seed.map((user) => [user.id, user]));
  let recovery:
    | Readonly<{
        expiresAt: number;
        tokenHash: string;
        userId: string;
      }>
    | undefined;

  return {
    async findActiveAdministrator(normalizedEmail) {
      return (
        [...users.values()].find(
          (user) =>
            user.email.toLowerCase() === normalizedEmail &&
            user.state === "active" &&
            user.role === "administrator",
        ) ?? null
      );
    },
    async write(input) {
      recovery = input;
    },
    async findActiveAdministratorByToken(tokenHash, occurredAt) {
      if (!recovery || recovery.tokenHash !== tokenHash || recovery.expiresAt <= occurredAt) {
        return null;
      }
      const user = users.get(recovery.userId);
      return user?.state === "active" && user.role === "administrator" ? user : null;
    },
    async use(input) {
      if (
        !recovery ||
        recovery.userId !== input.userId ||
        recovery.tokenHash !== input.tokenHash ||
        recovery.expiresAt <= input.occurredAt
      ) {
        return false;
      }
      recovery = undefined;
      return true;
    },
  };
}
