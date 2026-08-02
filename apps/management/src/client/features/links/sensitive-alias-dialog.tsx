import { useState } from "react";
import { z } from "zod";

import { ApiError, jsonRequest } from "../../api";
import { sessionResponseSchema } from "../../api-schemas";
import { AppDialog } from "../../components/app-dialog";
import { useAppForm } from "../../components/form/app-form";
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
  const [csrfToken, setCsrfToken] = useState(session.csrfToken);
  const [needsReauthentication, setNeedsReauthentication] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const formSchema = z
    .object({ confirmation: z.string(), password: z.string() })
    .superRefine(({ confirmation, password }, context) => {
      if (needsReauthentication) {
        if (!password) {
          context.addIssue({
            code: "custom",
            message: "Enter your current password.",
            path: ["password"],
          });
        }
      } else if (confirmation !== alias) {
        context.addIssue({
          code: "custom",
          message: `Type ${alias} exactly.`,
          path: ["confirmation"],
        });
      }
    });
  const form = useAppForm({
    defaultValues: { confirmation: "", password: "" },
    validators: {
      onBlur: formSchema,
      onChange: formSchema,
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      setError("");
      if (needsReauthentication) {
        try {
          const refreshed = await jsonRequest(
            "/api/internal/auth/reauthenticate",
            sessionResponseSchema,
            {
              method: "POST",
              csrfToken,
              body: { password: value.password },
            },
          );
          const nextSession = { user: refreshed.user, csrfToken: refreshed.csrfToken };
          // Recent authentication rotates the CSRF token, but the destructive
          // action still requires a second explicit submit with the new token.
          setCsrfToken(refreshed.csrfToken);
          onSession(nextSession);
          setNeedsReauthentication(false);
          setVerified(true);
          form.setFieldValue("password", "");
        } catch {
          setError("The password is incorrect.");
        }
        return;
      }

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
      }
    },
  });

  return (
    <AppDialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      title={title}
      description={description}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        {needsReauthentication ? (
          <form.AppField name="password">
            {(field) => (
              <field.PasswordField
                label="Current password"
                autoComplete="current-password"
                description="Verify your password to continue. The action will not run automatically."
              />
            )}
          </form.AppField>
        ) : (
          <form.AppField name="confirmation">
            {(field) => (
              <field.TextField
                label={
                  <>
                    Type <code>{alias}</code> to confirm
                  </>
                }
                autoComplete="off"
              />
            )}
          </form.AppField>
        )}
        {verified && (
          <p className="rounded-lg border bg-muted p-4 text-sm" role="status">
            Password verified. Submit the action again to continue.
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <form.AppForm>
          <form.SubmitButton
            variant="destructive"
            pendingLabel={needsReauthentication ? "Verifying…" : "Working…"}
          >
            {needsReauthentication ? "Verify password" : submitLabel}
          </form.SubmitButton>
        </form.AppForm>
      </form>
    </AppDialog>
  );
}
