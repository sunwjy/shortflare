import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { jsonRequest, noContentRequest } from "../../api";
import { passwordChangedResponseSchema } from "../../api-schemas";
import { useAppForm } from "../../components/form/app-form";
import { passwordSchema } from "../../components/form/form-schemas";
import { Button } from "../../components/ui/button";

const rootApi = getRouteApi("__root__");

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  password: passwordSchema,
});

export function SecurityPage() {
  const { session, onSession } = rootApi.useRouteContext();
  const [notice, setNotice] = useState("");
  const form = useAppForm({
    defaultValues: { currentPassword: "", password: "" },
    validators: {
      onBlur: changePasswordSchema,
      onChange: changePasswordSchema,
      onSubmit: changePasswordSchema,
    },
    onSubmit: async ({ value }) => {
      setNotice("");
      try {
        await jsonRequest("/api/internal/auth/password", passwordChangedResponseSchema, {
          method: "POST",
          csrfToken: session.csrfToken,
          body: value,
        });
        onSession(undefined);
      } catch {
        setNotice("The password could not be changed.");
      }
    },
  });

  async function logout() {
    await noContentRequest("/api/internal/auth/logout", {
      method: "POST",
      csrfToken: session.csrfToken,
      body: {},
    }).catch(() => undefined);
    onSession(undefined);
  }

  return (
    <>
      <header className="mb-7 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your password and active Session.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void logout()}>
          Log out
        </Button>
      </header>
      <section className="grid grid-cols-[repeat(auto-fit,minmax(18rem,32rem))] gap-4">
        <article className="rounded-lg border bg-card p-5 text-card-foreground">
          <h2 className="text-lg font-semibold tracking-tight">Change password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Changing your password signs out every browser and device.
          </p>
          <form
            className="mt-5 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.AppField name="currentPassword">
              {(field) => (
                <field.PasswordField label="Current password" autoComplete="current-password" />
              )}
            </form.AppField>
            <form.AppField name="password">
              {(field) => <field.PasswordField label="New password" autoComplete="new-password" />}
            </form.AppField>
            {notice && (
              <p className="text-sm text-destructive" role="alert">
                {notice}
              </p>
            )}
            <form.AppForm>
              <form.SubmitButton pendingLabel="Changing password…">
                Change password
              </form.SubmitButton>
            </form.AppForm>
          </form>
        </article>
      </section>
    </>
  );
}
