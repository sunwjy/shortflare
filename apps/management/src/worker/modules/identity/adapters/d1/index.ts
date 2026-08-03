import { createD1Database } from "@shortflare/database/d1";

import { createD1InitialSetupPersistence } from "./initial-setup";
import { createD1InvitationPersistence } from "./invitations";
import { createD1OperatorRecoveryPersistence } from "./operator-recovery";
import { createD1PasswordResetPersistence } from "./password-resets";
import { createD1SessionPersistence } from "./sessions";
import { createD1UserPersistence } from "./users";

export function createD1IdentityPersistence(binding: D1Database) {
  const database = createD1Database(binding);
  return {
    initialSetup: createD1InitialSetupPersistence(database),
    invitations: createD1InvitationPersistence(database),
    operatorRecovery: createD1OperatorRecoveryPersistence(database),
    passwordResets: createD1PasswordResetPersistence(database),
    sessions: createD1SessionPersistence(database),
    users: createD1UserPersistence(database),
  };
}
