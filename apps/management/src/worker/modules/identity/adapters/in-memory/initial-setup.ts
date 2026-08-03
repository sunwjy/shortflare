import type { InitialSetupPersistence } from "../../application/initial-setup";

export function createInMemoryInitialSetupPersistence(): InitialSetupPersistence {
  let completed = false;
  let setup: Parameters<InitialSetupPersistence["write"]>[0] | undefined;
  return {
    async isAvailable() {
      return !completed;
    },
    async write(input) {
      if (!completed) setup = input;
    },
    async find(tokenHash, occurredAt) {
      return setup?.tokenHash === tokenHash && setup.expiresAt > occurredAt
        ? {
            displayEmail: setup.displayEmail,
            normalizedEmail: setup.normalizedEmail,
          }
        : null;
    },
    async complete(input) {
      if (
        completed ||
        !setup ||
        setup.tokenHash !== input.tokenHash ||
        setup.expiresAt <= input.occurredAt
      ) {
        return false;
      }
      completed = true;
      setup = undefined;
      return true;
    },
  };
}
