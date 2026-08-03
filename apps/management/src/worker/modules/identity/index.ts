import { createD1InitialSetupPersistence } from "./adapters/d1/initial-setup";
import { createD1InvitationPersistence } from "./adapters/d1/invitations";
import { createD1OperatorRecoveryPersistence } from "./adapters/d1/operator-recovery";
import { createD1PasswordResetPersistence } from "./adapters/d1/password-resets";
import { createD1SessionPersistence } from "./adapters/d1/sessions";
import { createD1UserPersistence } from "./adapters/d1/users";
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
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const randomToken = options.randomToken ?? createRandomToken;
  const initialSetup = createInitialSetup(createD1InitialSetupPersistence(options.db), {
    now,
    randomId,
  });
  const sessions = createSessions(createD1SessionPersistence(options.db), {
    now,
    randomId,
    randomToken,
  });
  const invitations = createInvitations({
    persistence: createD1InvitationPersistence(options.db),
    now,
    randomId,
    randomToken,
  });
  const users = createUsers(createD1UserPersistence(options.db), { now, randomId });
  const passwordResets = createPasswordResets(createD1PasswordResetPersistence(options.db), {
    now,
    randomId,
    randomToken,
  });
  const operatorRecovery = createOperatorRecovery(createD1OperatorRecoveryPersistence(options.db), {
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
