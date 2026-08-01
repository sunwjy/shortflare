import { type FormEvent, useState } from "react";

import { ApiError, jsonRequest } from "../../api";
import { sessionResponseSchema } from "../../api-schemas";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import type { Session } from "../../types";

export function SensitiveAliasDialog({
  open,
  alias,
  title,
  description,
  submitLabel,
  session,
  onSession,
  onClose,
  execute,
  onSuccess,
}: Readonly<{
  open: boolean;
  alias: string;
  title: string;
  description: string;
  submitLabel: string;
  session: Session;
  onSession: (session: Session | undefined) => void;
  onClose: () => void;
  execute: (csrfToken: string) => Promise<unknown>;
  onSuccess: () => Promise<void>;
}>) {
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [csrfToken, setCsrfToken] = useState(session.csrfToken);
  const [needsReauthentication, setNeedsReauthentication] = useState(false);
  const [verified, setVerified] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (needsReauthentication) {
      setPending(true);
      try {
        const refreshed = await jsonRequest(
          "/api/internal/auth/reauthenticate",
          sessionResponseSchema,
          {
            method: "POST",
            csrfToken,
            body: { password },
          },
        );
        const nextSession = { user: refreshed.user, csrfToken: refreshed.csrfToken };
        // Recent authentication rotates the CSRF token, but the destructive
        // action still requires a second explicit submit with the new token.
        setCsrfToken(refreshed.csrfToken);
        onSession(nextSession);
        setNeedsReauthentication(false);
        setVerified(true);
        setPassword("");
      } catch {
        setError("The password is incorrect.");
      } finally {
        setPending(false);
      }
      return;
    }

    setPending(true);
    try {
      await execute(csrfToken);
      await onSuccess();
    } catch (caught) {
      if (caught instanceof ApiError && caught.body.kind === "reauthentication-required") {
        setNeedsReauthentication(true);
        setError("");
      } else if (caught instanceof ApiError && caught.body.kind === "confirmation-mismatch") {
        setError("The Alias does not match.");
      } else {
        setError("The action could not be completed.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      title={title}
      description={description}
    >
      <form className="link-form" onSubmit={(event) => void submit(event)}>
        {needsReauthentication ? (
          <div className="field">
            <label htmlFor="sensitive-password">Current password</label>
            <input
              required
              id="sensitive-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <span>Verify your password to continue. The action will not run automatically.</span>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="alias-confirmation">
              Type <code>{alias}</code> to confirm
            </label>
            <input
              required
              id="alias-confirmation"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
        )}
        {verified && (
          <p className="notice" role="status">
            Password verified. Submit the action again to continue.
          </p>
        )}
        {error && <p className="field-error">{error}</p>}
        <Button
          type="submit"
          variant="danger"
          disabled={
            pending || (needsReauthentication ? password.length === 0 : confirmation !== alias)
          }
        >
          {needsReauthentication
            ? pending
              ? "Verifying…"
              : "Verify password"
            : pending
              ? "Working…"
              : submitLabel}
        </Button>
      </form>
    </Dialog>
  );
}
