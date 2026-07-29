import { createPasswordVerifier } from "../passwords";
import { hashToken, parseUserEmail, type User } from "./shared";

export type OperatorRecoveryPersistence = {
  findActiveAdministrator(normalizedEmail: string): Promise<User | null>;
  write(input: WriteRecoveryRecord): Promise<void>;
  findActiveAdministratorByToken(tokenHash: string, occurredAt: number): Promise<User | null>;
  use(input: UseRecoveryRecord): Promise<boolean>;
};

export type WriteRecoveryRecord = Readonly<{
  createdAt: number;
  expiresAt: number;
  tokenHash: string;
  userId: string;
}>;

export type UseRecoveryRecord = Readonly<{
  auditId: string;
  occurredAt: number;
  tokenHash: string;
  userId: string;
  verifier: string;
}>;

export function createOperatorRecovery(
  persistence: OperatorRecoveryPersistence,
  dependencies: Readonly<{ now: () => Date; randomId: () => string }>,
) {
  return {
    async writeOperatorRecovery(
      input: Readonly<{ email: string; token: string; expiresAt: Date }>,
    ) {
      const email = parseUserEmail(input.email);
      const user = email ? await persistence.findActiveAdministrator(email.normalized) : null;
      if (!user) throw new Error("Active Administrator not found");

      await persistence.write({
        createdAt: dependencies.now().getTime(),
        expiresAt: input.expiresAt.getTime(),
        tokenHash: await hashToken(input.token),
        userId: user.id,
      });
    },

    async useOperatorRecovery(input: Readonly<{ token: string; password: string }>) {
      const occurredAt = dependencies.now().getTime();
      const tokenHash = await hashToken(input.token);
      const user = await persistence.findActiveAdministratorByToken(tokenHash, occurredAt);
      if (!user) return { ok: false, kind: "invalid-or-expired-token" } as const;

      const verifier = await createPasswordVerifier(input.password);
      if (!verifier) return { ok: false, kind: "invalid-password" } as const;

      const used = await persistence.use({
        auditId: dependencies.randomId(),
        occurredAt,
        tokenHash,
        userId: user.id,
        verifier,
      });
      return used
        ? ({ ok: true, kind: "operator-recovery", user } as const)
        : ({ ok: false, kind: "invalid-or-expired-token" } as const);
    },
  };
}
