import { getRouteApi } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { jsonRequest, noContentRequest } from "../../api";
import { passwordChangedResponseSchema } from "../../api-schemas";
import { Button } from "../../components/ui/button";

const rootApi = getRouteApi("__root__");

export function SecurityPage() {
  const { session, onSession } = rootApi.useRouteContext();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    try {
      await jsonRequest("/api/internal/auth/password", passwordChangedResponseSchema, {
        method: "POST",
        csrfToken: session.csrfToken,
        body: { currentPassword, password: newPassword },
      });
      onSession(undefined);
    } catch {
      setNotice("The password could not be changed.");
    }
  }

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
      <header className="page-header">
        <div>
          <h1>Security</h1>
          <p>Manage your password and active Session.</p>
        </div>
        <Button variant="secondary" onClick={() => void logout()}>
          Log out
        </Button>
      </header>
      <section className="settings-grid">
        <article className="card">
          <h2>Change password</h2>
          <p>Changing your password signs out every browser and device.</p>
          <form className="link-form" onSubmit={(event) => void changePassword(event)}>
            <div className="field">
              <label htmlFor="current-password">Current password</label>
              <input
                required
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                required
                id="new-password"
                type="password"
                minLength={15}
                maxLength={128}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            {notice && <p className="field-error">{notice}</p>}
            <Button type="submit">Change password</Button>
          </form>
        </article>
      </section>
    </>
  );
}
