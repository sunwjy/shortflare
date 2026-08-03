import { createPasswordVerifier } from "./passwords";
import { hashToken, parseUserEmail, toUser, type User, type UserRole } from "./shared";

const invitationDuration = 24 * 60 * 60 * 1_000;

export type InvitationPersistence = {
  findUserByNormalizedEmail(normalizedEmail: string): Promise<User | null>;
  issue(input: IssueInvitationRecord): Promise<boolean>;
  findInvitedUser(tokenHash: string, occurredAt: number): Promise<User | null>;
  accept(input: AcceptInvitationRecord): Promise<boolean>;
  cancel(input: CancelInvitationRecord): Promise<boolean>;
};

type IssueInvitationRecord = Readonly<{
  actorId: string;
  auditId: string;
  displayEmail: string;
  normalizedEmail: string;
  existing: User | null;
  expiresAt: number;
  invitationId: string;
  occurredAt: number;
  role: UserRole;
  tokenHash: string;
  userId: string;
}>;

type AcceptInvitationRecord = Readonly<{
  auditId: string;
  occurredAt: number;
  tokenHash: string;
  userId: string;
  verifier: string;
}>;

type CancelInvitationRecord = Readonly<{
  actorId: string;
  auditId: string;
  occurredAt: number;
  userId: string;
}>;

type InvitationDependencies = Readonly<{
  persistence: InvitationPersistence;
  now: () => Date;
  randomId: () => string;
  randomToken: () => string;
}>;

export function createInvitations(dependencies: InvitationDependencies) {
  return {
    async issueInvitation(input: Readonly<{ actorId: string; email: string; role: UserRole }>) {
      const email = parseUserEmail(input.email);
      if (!email) {
        return { ok: false, kind: "invalid-email" } as const;
      }
      const existing = await dependencies.persistence.findUserByNormalizedEmail(email.normalized);
      if (existing?.state === "active") {
        return { ok: false, kind: "user-active" } as const;
      }
      if (existing?.state === "suspended") {
        return { ok: false, kind: "user-suspended" } as const;
      }

      const occurredAt = dependencies.now().getTime();
      const expiresAt = new Date(occurredAt + invitationDuration);
      const userId = existing?.id ?? dependencies.randomId();
      const token = dependencies.randomToken();
      const issued = await dependencies.persistence.issue({
        actorId: input.actorId,
        auditId: dependencies.randomId(),
        displayEmail: email.display,
        normalizedEmail: email.normalized,
        existing,
        expiresAt: expiresAt.getTime(),
        invitationId: dependencies.randomId(),
        occurredAt,
        role: input.role,
        tokenHash: await hashToken(token),
        userId,
      });
      if (!issued) {
        return { ok: false, kind: "user-active" } as const;
      }

      return {
        ok: true,
        kind: "invitation",
        invitation: {
          user: {
            id: userId,
            email: email.display,
            role: input.role,
            state: "invited",
          },
          token,
          expiresAt,
        },
      } as const;
    },

    async acceptInvitation(input: Readonly<{ token: string; password: string }>) {
      const occurredAt = dependencies.now().getTime();
      const tokenHash = await hashToken(input.token);
      const invited = await dependencies.persistence.findInvitedUser(tokenHash, occurredAt);
      if (!invited) {
        return { ok: false, kind: "invalid-or-expired-token" } as const;
      }
      const verifier = await createPasswordVerifier(input.password);
      if (!verifier) {
        return { ok: false, kind: "invalid-password" } as const;
      }

      const accepted = await dependencies.persistence.accept({
        auditId: dependencies.randomId(),
        occurredAt,
        tokenHash,
        userId: invited.id,
        verifier,
      });
      return accepted
        ? ({
            ok: true,
            kind: "user",
            user: { ...toUser(invited), state: "active" },
          } as const)
        : ({ ok: false, kind: "invalid-or-expired-token" } as const);
    },

    async cancelInvitation(input: Readonly<{ actorId: string; userId: string }>) {
      const cancelled = await dependencies.persistence.cancel({
        actorId: input.actorId,
        auditId: dependencies.randomId(),
        occurredAt: dependencies.now().getTime(),
        userId: input.userId,
      });
      return cancelled
        ? ({ ok: true, kind: "invitation-cancelled" } as const)
        : ({ ok: false, kind: "invitation-not-found" } as const);
    },
  };
}
