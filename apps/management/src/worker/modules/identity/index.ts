import { createD1IdentityPersistence } from "./adapters/d1";
import { createInitialSetup } from "./application/initial-setup";
import { createInvitations } from "./application/invitations";
import { createOperatorRecovery } from "./application/operator-recovery";
import { createPasswordResets } from "./application/password-resets";
import { createSessions } from "./application/sessions";
import { createRandomToken } from "./application/shared";
import { createUsers } from "./application/users";

export type { User, UserRole, UserState } from "./application/shared";

type IdentityOptions = Readonly<{
  db: D1Database;
  now?: () => Date;
  randomId?: () => string;
  randomToken?: () => string;
}>;

/**
 * Owns User lifecycle, credentials, one-time tokens, and Session policy for one
 * Instance. The public interface is the application test surface; capability
 * modules use internal persistence seams whose D1 adapters retain atomic audit
 * and state changes.
 *
 * Token-returning methods expose the plaintext secret exactly once while only
 * its hash is persisted. Callers are responsible for transport authorization
 * and for delivering that secret without logging it.
 */
export function createIdentity(options: IdentityOptions) {
  const persistence = createD1IdentityPersistence(options.db);
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const randomToken = options.randomToken ?? createRandomToken;
  const initialSetup = createInitialSetup(persistence.initialSetup, {
    now,
    randomId,
  });
  const sessions = createSessions(persistence.sessions, {
    now,
    randomId,
    randomToken,
  });
  const invitations = createInvitations({
    persistence: persistence.invitations,
    now,
    randomId,
    randomToken,
  });
  const users = createUsers(persistence.users, { now, randomId });
  const passwordResets = createPasswordResets(persistence.passwordResets, {
    now,
    randomId,
    randomToken,
  });
  const operatorRecovery = createOperatorRecovery(persistence.operatorRecovery, {
    now,
    randomId,
  });

  return {
    initialSetup,
    invitations,
    operatorRecovery,
    passwordResets,
    sessions,
    users,
  };
}

export type Identity = ReturnType<typeof createIdentity>;
