import type { User, UserRole } from "./shared";

export type UserPersistence = {
  list(): Promise<readonly User[]>;
  find(userId: string): Promise<User | null>;
  changeRole(input: ChangeRoleRecord): Promise<boolean>;
  suspend(input: SuspendUserRecord): Promise<boolean>;
  reactivate(input: ReactivateUserRecord): Promise<boolean>;
};

export type ChangeRoleRecord = Readonly<{
  actorId: string;
  auditId: string;
  occurredAt: number;
  recentlyAuthenticated: boolean;
  role: UserRole;
  storedRole: UserRole;
  userId: string;
}>;

export type SuspendUserRecord = Readonly<{
  actorId: string;
  auditId: string;
  occurredAt: number;
  recentlyAuthenticated: boolean;
  userId: string;
}>;

export type ReactivateUserRecord = Readonly<{
  actorId: string;
  auditId: string;
  occurredAt: number;
  userId: string;
}>;

export function createUsers(
  persistence: UserPersistence,
  dependencies: Readonly<{ now: () => Date; randomId: () => string }>,
) {
  return {
    listUsers: () => persistence.list(),

    async getUser(userId: string) {
      return (await persistence.find(userId)) ?? undefined;
    },

    async changeRole(
      input: Readonly<{
        actorId: string;
        userId: string;
        role: UserRole;
        recentlyAuthenticated: boolean;
      }>,
    ) {
      const stored = await persistence.find(input.userId);
      if (!stored || stored.state === "invited") {
        return { ok: false, kind: "user-not-found" } as const;
      }
      if (stored.role === input.role) {
        return { ok: true, kind: "unchanged" } as const;
      }

      const changed = await persistence.changeRole({
        ...input,
        auditId: dependencies.randomId(),
        occurredAt: dependencies.now().getTime(),
        storedRole: stored.role,
      });
      if (changed) return { ok: true, kind: "role-changed" } as const;

      const current = await persistence.find(input.userId);
      if (
        !input.recentlyAuthenticated &&
        (input.role === "administrator" || current?.role === "administrator")
      ) {
        return { ok: false, kind: "reauthentication-required" } as const;
      }
      return {
        ok: false,
        kind:
          stored.state === "active" && stored.role === "administrator"
            ? ("last-active-administrator" as const)
            : ("user-not-found" as const),
      };
    },

    async suspendUser(
      input: Readonly<{
        actorId: string;
        userId: string;
        recentlyAuthenticated: boolean;
      }>,
    ) {
      const stored = await persistence.find(input.userId);
      if (!stored || stored.state !== "active") {
        return { ok: false, kind: "user-not-found" } as const;
      }
      const suspended = await persistence.suspend({
        ...input,
        auditId: dependencies.randomId(),
        occurredAt: dependencies.now().getTime(),
      });
      if (suspended) return { ok: true, kind: "user-suspended" } as const;

      const current = await persistence.find(input.userId);
      if (!input.recentlyAuthenticated && current?.role === "administrator") {
        return { ok: false, kind: "reauthentication-required" } as const;
      }
      return {
        ok: false,
        kind:
          stored.role === "administrator"
            ? ("last-active-administrator" as const)
            : ("user-not-found" as const),
      };
    },

    async reactivateUser(input: Readonly<{ actorId: string; userId: string }>) {
      const stored = await persistence.find(input.userId);
      if (!stored || stored.state !== "suspended") {
        return { ok: false, kind: "user-not-found" } as const;
      }
      const reactivated = await persistence.reactivate({
        ...input,
        auditId: dependencies.randomId(),
        occurredAt: dependencies.now().getTime(),
      });
      return reactivated
        ? ({ ok: true, kind: "user-reactivated", user: { ...stored, state: "active" } } as const)
        : ({ ok: false, kind: "user-not-found" } as const);
    },
  };
}
