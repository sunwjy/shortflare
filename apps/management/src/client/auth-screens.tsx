import { useState } from "react";
import { z } from "zod";

import { ApiError, jsonRequest } from "./api";
import { identityUserResponseSchema, sessionResponseSchema } from "./api-schemas";
import { useAppForm } from "./components/form/app-form";
import { emailSchema, passwordSchema } from "./components/form/form-schemas";
import { ThemeField } from "./components/theme-field";
import type { Theme } from "./theme";
import type { Session, TokenRoute } from "./types";

type ThemeProps = Readonly<{ theme: Theme; onTheme: (theme: Theme) => void }>;

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

const tokenPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmation: z.string().min(1, "Confirm your password."),
  })
  .superRefine(({ password, confirmation }, context) => {
    if (confirmation && password !== confirmation) {
      context.addIssue({
        code: "custom",
        message: "Passwords do not match.",
        path: ["confirmation"],
      });
    }
  });

export function LoginScreen({
  onLogin,
  theme,
  onTheme,
}: Readonly<{ onLogin: (session: Session) => void }> & ThemeProps) {
  const [error, setError] = useState("");
  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: {
      onBlur: loginSchema,
      onChange: loginSchema,
      onSubmit: loginSchema,
    },
    onSubmit: async ({ value }) => {
      setError("");
      try {
        const response = await jsonRequest("/api/internal/auth/login", sessionResponseSchema, {
          method: "POST",
          body: value,
        });
        onLogin({ user: response.user, csrfToken: response.csrfToken });
      } catch {
        setError("Email or password is invalid.");
      }
    },
  });

  return (
    <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-card p-8 text-card-foreground">
        <p className="mb-2 text-sm font-semibold text-primary">Shortflare</p>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage Links on your private Instance.</p>
        <form
          className="mt-6 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="email">
            {(field) => <field.TextField label="User Email" type="email" autoComplete="email" />}
          </form.AppField>
          <form.AppField name="password">
            {(field) => <field.PasswordField label="Password" autoComplete="current-password" />}
          </form.AppField>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <form.AppForm>
            <form.SubmitButton size="lg" pendingLabel="Signing in…">
              Sign in
            </form.SubmitButton>
          </form.AppForm>
        </form>
        <ThemeField className="mt-6" theme={theme} onTheme={onTheme} />
      </section>
    </main>
  );
}

export function TokenPasswordScreen({
  route,
  theme,
  onTheme,
}: Readonly<{ route: TokenRoute }> & ThemeProps) {
  const [result, setResult] = useState<{ kind: "error" | "success"; message: string }>();
  const title = {
    setup: "Set up the initial Administrator",
    invitation: "Accept your Invitation",
    reset: "Choose a new password",
    recovery: "Recover Administrator access",
  }[route.kind];

  const form = useAppForm({
    defaultValues: { password: "", confirmation: "" },
    validators: {
      onBlur: tokenPasswordSchema,
      onChange: tokenPasswordSchema,
      onSubmit: tokenPasswordSchema,
    },
    onSubmit: async ({ value }) => {
      setResult(undefined);
      try {
        await jsonRequest(route.endpoint, identityUserResponseSchema, {
          method: "POST",
          body: { token: route.token, password: value.password },
        });
        setResult({ kind: "success", message: "Password saved. You can now sign in." });
      } catch (error) {
        setResult({
          kind: "error",
          message:
            error instanceof ApiError && error.body.kind === "invalid-or-expired-token"
              ? "This one-time link is invalid or expired."
              : "The password could not be saved.",
        });
      }
    },
  });

  return (
    <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
      <section className="w-full max-w-md rounded-xl border bg-card p-8 text-card-foreground">
        <p className="mb-2 text-sm font-semibold text-primary">One-time link</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use 15–128 characters. Spaces and Unicode are welcome.
        </p>
        <form
          className="mt-6 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="password">
            {(field) => <field.PasswordField label="New password" autoComplete="new-password" />}
          </form.AppField>
          <form.AppField name="confirmation">
            {(field) => (
              <field.PasswordField label="Confirm password" autoComplete="new-password" />
            )}
          </form.AppField>
          {result && (
            <p
              className={
                result.kind === "success" ? "text-sm text-success" : "text-sm text-destructive"
              }
              role={result.kind === "success" ? "status" : "alert"}
            >
              {result.message}
            </p>
          )}
          <form.AppForm>
            <form.SubmitButton size="lg" pendingLabel="Saving password…">
              Save password
            </form.SubmitButton>
          </form.AppForm>
          <a className="text-center text-sm text-primary hover:underline" href="/">
            Return to sign in
          </a>
        </form>
        <ThemeField className="mt-6" theme={theme} onTheme={onTheme} />
      </section>
    </main>
  );
}
