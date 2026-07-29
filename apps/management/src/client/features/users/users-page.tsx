import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { CheckCircle2, LockKeyhole, Mail } from "lucide-react";
import { useState } from "react";

import { jsonRequest } from "../../api";
import { invitationResponseSchema, usersResponseSchema } from "../../api-schemas";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import type { Session } from "../../types";

const rootApi = getRouteApi("__root__");

export function UsersPage() {
  const { session } = rootApi.useRouteContext();
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Session["user"]["role"]>("member");
  const [invitationLink, setInvitationLink] = useState("");
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => jsonRequest("/api/internal/users", usersResponseSchema),
    enabled: session.user.role === "administrator",
  });
  const invitation = useMutation({
    mutationFn: () =>
      jsonRequest("/api/internal/users/invitations", invitationResponseSchema, {
        method: "POST",
        csrfToken: session.csrfToken,
        body: { email, role },
      }),
    onSuccess: async ({ invitation: createdInvitation }) => {
      setInvitationLink(
        `${location.origin}/accept-invitation#token=${encodeURIComponent(createdInvitation.token)}`,
      );
      setInviting(false);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  if (session.user.role !== "administrator") {
    return (
      <section className="empty-state">
        <h1>Not available</h1>
        <p>User administration is restricted to Administrators.</p>
      </section>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p>Invite people and manage access to this Instance.</p>
        </div>
        <Button onClick={() => setInviting(true)}>Invite User</Button>
      </header>
      {invitationLink && (
        <section className="notice one-time-link" aria-label="One-time Invitation link">
          <strong>Copy this one-time link now</strong>
          <code>{invitationLink}</code>
        </section>
      )}
      <section className="collection" aria-label="User collection">
        {users.isPending && <LinkRowsSkeleton />}
        {users.data?.users.map((user) => (
          <article className="user-row" key={user.id}>
            <div>
              <strong>{user.email}</strong>
              <span>{roleLabel(user.role)}</span>
            </div>
            <StatusChipForUser state={user.state} />
          </article>
        ))}
      </section>
      <Dialog
        open={inviting}
        onOpenChange={setInviting}
        title="Invite User"
        description="Create a one-time invitation for a new Shortflare User."
      >
        <form
          className="link-form"
          onSubmit={(event) => {
            event.preventDefault();
            invitation.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="invite-email">Email</label>
            <input
              required
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="invite-role">Role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as Session["user"]["role"])}
            >
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="administrator">Administrator</option>
            </select>
          </div>
          {invitation.isError && (
            <p className="field-error">The invitation could not be created.</p>
          )}
          <Button type="submit" disabled={invitation.isPending}>
            Create Invitation
          </Button>
        </form>
      </Dialog>
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
    <span className={`status-chip status-chip--${state}`}>
      <Icon aria-hidden="true" size={14} strokeWidth={1.75} />
      {{ invited: "Invited User", active: "Active User", suspended: "Suspended User" }[state]}
    </span>
  );
}

function LinkRowsSkeleton() {
  return (
    <div className="link-row-skeletons" aria-label="Loading Users">
      <div />
      <div />
      <div />
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
