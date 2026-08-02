import { createPasswordVerifier } from "../passwords";
import { hashToken, type User } from "./shared";

const passwordResetDuration = 30 * 60 * 1_000;

export type PasswordResetPersistence = {
  findUser(userId: string): Promise<User | null>;
  issue(input: IssuePasswordResetRecord): Promise<void>;
  findActiveUserByToken(tokenHash: string, occurredAt: number): Promise<User | null>;
  use(input: UsePasswordResetRecord): Promise<boolean>;
};

export type IssuePasswordResetRecord = Readonly<{
  actorId: string;
  auditId: string;
  expiresAt: number;
  occurredAt: number;
  resetId: string;
  tokenHash: string;
  userId: string;
}>;

export type UsePasswordResetRecord = Readonly<{
  auditId: string;
  occurredAt: number;
  tokenHash: string;
  userId: string;
  verifier: string;
}>;

export function createPasswordResets(
  persistence: PasswordResetPersistence,
  dependencies: Readonly<{
    now: () => Date;
    randomId: () => string;
    randomToken: () => string;
  }>,
) {
  return {
    async issuePasswordReset(input: Readonly<{ actorId: string; userId: string }>) {
      const user = await persistence.findUser(input.userId);
      if (!user || user.state === "invited") {
        return { ok: false, kind: "user-not-found" } as const;
      }
      if (user.state === "suspended") {
        return { ok: false, kind: "user-suspended" } as const;
      }
      const occurredAt = dependencies.now().getTime();
      const expiresAt = new Date(occurredAt + passwordResetDuration);
      const token = dependencies.randomToken();
      await persistence.issue({
        actorId: input.actorId,
        auditId: dependencies.randomId(),
        expiresAt: expiresAt.getTime(),
        occurredAt,
        resetId: dependencies.randomId(),
        tokenHash: await hashToken(token),
        userId: user.id,
      });
      return {
        ok: true,
        kind: "password-reset",
        passwordReset: { user, token, expiresAt },
      } as const;
    },

    async usePasswordReset(input: Readonly<{ token: string; password: string }>) {
      const occurredAt = dependencies.now().getTime();
      const tokenHash = await hashToken(input.token);
      const user = await persistence.findActiveUserByToken(tokenHash, occurredAt);
      if (!user) {
        return { ok: false, kind: "invalid-or-expired-token" } as const;
      }
      const verifier = await createPasswordVerifier(input.password);
      if (!verifier) {
        return { ok: false, kind: "invalid-password" } as const;
      }
      const used = await persistence.use({
        auditId: dependencies.randomId(),
        occurredAt,
        tokenHash,
        userId: user.id,
        verifier,
      });
      return used
        ? ({ ok: true, kind: "password-reset", user } as const)
        : ({ ok: false, kind: "invalid-or-expired-token" } as const);
    },
  };
}
