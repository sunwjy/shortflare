import type { User } from "./shared";
import type { UserPersistence } from "./users";

export function createInMemoryUserPersistence(seed: readonly User[]): UserPersistence {
  const users = new Map(seed.map((user) => [user.id, structuredClone(user)]));

  return {
    async list() {
      return [...users.values()].map((user) => structuredClone(user));
    },

    async find(userId) {
      const user = users.get(userId);
      return user ? structuredClone(user) : null;
    },

    async changeRole(input) {
      const user = users.get(input.userId);
      if (!user || user.state === "invited" || user.role !== input.storedRole) return false;
      if (
        !input.recentlyAuthenticated &&
        (user.role === "administrator" || input.role === "administrator")
      ) {
        return false;
      }
      if (
        user.state === "active" &&
        user.role === "administrator" &&
        input.role !== "administrator" &&
        activeAdministratorCount(users) === 1
      ) {
        return false;
      }
      users.set(user.id, { ...user, role: input.role });
      return true;
    },

    async suspend(input) {
      const user = users.get(input.userId);
      if (!user || user.state !== "active") return false;
      if (user.role === "administrator" && !input.recentlyAuthenticated) return false;
      if (user.role === "administrator" && activeAdministratorCount(users) === 1) return false;
      users.set(user.id, { ...user, state: "suspended" });
      return true;
    },

    async reactivate(input) {
      const user = users.get(input.userId);
      if (!user || user.state !== "suspended") return false;
      users.set(user.id, { ...user, state: "active" });
      return true;
    },
  };
}

function activeAdministratorCount(users: ReadonlyMap<string, User>) {
  return [...users.values()].filter(
    (user) => user.state === "active" && user.role === "administrator",
  ).length;
}
