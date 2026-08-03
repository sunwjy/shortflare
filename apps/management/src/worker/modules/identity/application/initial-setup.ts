import { createPasswordVerifier } from "./passwords";
import { hashToken, parseUserEmail, type User } from "./shared";

export type InitialSetupPersistence = {
  isAvailable(): Promise<boolean>;
  write(input: WriteInitialSetupRecord): Promise<void>;
  find(
    tokenHash: string,
    occurredAt: number,
  ): Promise<Readonly<{
    displayEmail: string;
    normalizedEmail: string;
  }> | null>;
  complete(input: CompleteInitialSetupRecord): Promise<boolean>;
};

export type WriteInitialSetupRecord = Readonly<{
  createdAt: number;
  displayEmail: string;
  expiresAt: number;
  normalizedEmail: string;
  tokenHash: string;
}>;

export type CompleteInitialSetupRecord = Readonly<{
  auditId: string;
  displayEmail: string;
  normalizedEmail: string;
  occurredAt: number;
  tokenHash: string;
  userId: string;
  verifier: string;
}>;

export function createInitialSetup(
  persistence: InitialSetupPersistence,
  dependencies: Readonly<{ now: () => Date; randomId: () => string }>,
) {
  return {
    async writeInitialSetup(
      input: Readonly<{ displayEmail: string; token: string; expiresAt: Date }>,
    ) {
      const email = parseUserEmail(input.displayEmail);
      if (!email) throw new Error("Invalid initial Administrator email");
      if (!(await persistence.isAvailable())) {
        throw new Error("Initial setup is permanently closed");
      }
      await persistence.write({
        createdAt: dependencies.now().getTime(),
        displayEmail: email.display,
        expiresAt: input.expiresAt.getTime(),
        normalizedEmail: email.normalized,
        tokenHash: await hashToken(input.token),
      });
    },

    async completeInitialSetup(input: Readonly<{ token: string; password: string }>) {
      const occurredAt = dependencies.now().getTime();
      const tokenHash = await hashToken(input.token);
      const setup = await persistence.find(tokenHash, occurredAt);
      if (!setup) return { ok: false, kind: "invalid-or-expired-token" } as const;

      const verifier = await createPasswordVerifier(input.password);
      if (!verifier) return { ok: false, kind: "invalid-password" } as const;

      const userId = dependencies.randomId();
      const completed = await persistence.complete({
        auditId: dependencies.randomId(),
        ...setup,
        occurredAt,
        tokenHash,
        userId,
        verifier,
      });
      const user: User = {
        id: userId,
        email: setup.displayEmail,
        role: "administrator",
        state: "active",
      };
      return completed
        ? ({ ok: true, kind: "user", user } as const)
        : ({ ok: false, kind: "invalid-or-expired-token" } as const);
    },
  };
}
