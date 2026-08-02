import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { CheckCircle2, LockKeyhole, Mail } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { jsonRequest } from "../../api";
import { invitationResponseSchema, usersResponseSchema } from "../../api-schemas";
import { AppDialog } from "../../components/app-dialog";
import { useAppForm } from "../../components/form/app-form";
import { emailSchema } from "../../components/form/form-schemas";
import { Button } from "../../components/ui/button";
import type { Session } from "../../types";

const rootApi = getRouteApi("__root__");

const invitationSchema = z.object({
  email: emailSchema,
  role: z.enum(["administrator", "member", "viewer"]),
});

const roleOptions = [
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
  { value: "administrator", label: "Administrator" },
] as const;

export function UsersPage() {
  const { session } = rootApi.useRouteContext();
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [invitationError, setInvitationError] = useState("");
  const [invitationLink, setInvitationLink] = useState("");
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => jsonRequest("/api/internal/users", usersResponseSchema),
    enabled: session.user.role === "administrator",
  });
  const form = useAppForm({
    defaultValues: { email: "", role: "member" as Session["user"]["role"] },
    validators: {
      onBlur: invitationSchema,
      onChange: invitationSchema,
      onSubmit: invitationSchema,
    },
    onSubmit: async ({ value }) => {
      setInvitationError("");
      try {
        const { invitation } = await jsonRequest(
          "/api/internal/users/invitations",
          invitationResponseSchema,
          {
            method: "POST",
            csrfToken: session.csrfToken,
            body: value,
          },
        );
        setInvitationLink(
          `${location.origin}/accept-invitation#token=${encodeURIComponent(invitation.token)}`,
        );
        setInviting(false);
        form.reset();
        await queryClient.invalidateQueries({ queryKey: ["users"] });
      } catch {
        setInvitationError("The invitation could not be created.");
      }
    },
  });

  if (session.user.role !== "administrator") {
    return (
      <section className="mx-auto my-8 rounded-lg border bg-card p-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          User administration is restricted to Administrators.
        </p>
      </section>
    );
  }

  return (
    <>
      <header className="mb-7 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite people and manage access to this Instance.
          </p>
        </div>
        <Button onClick={() => setInviting(true)}>Invite User</Button>
      </header>
      {invitationLink && (
        <section
          className="mb-4 grid gap-2 rounded-lg border bg-card p-4 text-sm"
          aria-label="One-time Invitation link"
        >
          <strong>Copy this one-time link now</strong>
          <code>{invitationLink}</code>
        </section>
      )}
      <section className="border-t" aria-label="User collection">
        {users.isPending && <LinkRowsSkeleton />}
        {users.data?.users.map((user) => (
          <article
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-3 py-4"
            key={user.id}
          >
            <div className="grid gap-1">
              <strong>{user.email}</strong>
              <span className="text-xs text-muted-foreground">{roleLabel(user.role)}</span>
            </div>
            <StatusChipForUser state={user.state} />
          </article>
        ))}
      </section>
      <AppDialog
        open={inviting}
        onOpenChange={(open) => {
          setInviting(open);
          if (!open) {
            setInvitationError("");
            form.reset();
          }
        }}
        title="Invite User"
        description="Create a one-time invitation for a new Shortflare User."
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="email">
            {(field) => <field.TextField label="Email" type="email" />}
          </form.AppField>
          <form.AppField name="role">
            {(field) => <field.SelectField label="Role" options={roleOptions} />}
          </form.AppField>
          {invitationError && (
            <p className="text-sm text-destructive" role="alert">
              {invitationError}
            </p>
          )}
          <form.AppForm>
            <form.SubmitButton pendingLabel="Creating Invitation…">
              Create Invitation
            </form.SubmitButton>
          </form.AppForm>
        </form>
      </AppDialog>
    </>
  );
}

function StatusChipForUser({ state }: Readonly<{ state: Session["user"]["state"] }>) {
  const Icon = {
    invited: Mail,
    active: CheckCircle2,
    suspended: LockKeyhole,
  }[state];
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold capitalize ${
        state === "active"
          ? "bg-success-soft text-success"
          : state === "suspended"
            ? "bg-destructive/10 text-destructive"
            : "bg-neutral-soft text-neutral"
      }`}
    >
      <Icon aria-hidden="true" size={14} strokeWidth={1.75} />
      {{ invited: "Invited User", active: "Active User", suspended: "Suspended User" }[state]}
    </span>
  );
}

function LinkRowsSkeleton() {
  return (
    <div className="grid" aria-label="Loading Users">
      <div className="h-16 animate-pulse border-b bg-muted" />
      <div className="h-16 animate-pulse border-b bg-muted" />
      <div className="h-16 animate-pulse border-b bg-muted" />
    </div>
  );
}

function roleLabel(role: Session["user"]["role"]) {
  return {
    administrator: "Administrator",
    member: "Member",
    viewer: "Viewer",
  }[role];
}
