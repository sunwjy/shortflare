/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- Interactive form callbacks are local to this small MVP screen. */
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Role = "administrator" | "member" | "viewer";
type UserState = "invited" | "active" | "suspended";
type User = Readonly<{
  id: string;
  email: string;
  role: Role;
  state: UserState;
}>;

type Session = Readonly<{ user: User; csrfToken: string }>;

export function App() {
  const tokenRoute = useMemo(readTokenRoute, []);
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (tokenRoute) {
      setLoading(false);
      return;
    }
    void api("/api/internal/auth/session")
      .then((response) => {
        if (response.ok) {
          setSession({ user: response.user as User, csrfToken: String(response.csrfToken) });
        }
      })
      .finally(() => setLoading(false));
  }, [tokenRoute]);

  if (tokenRoute) {
    return <TokenPasswordScreen route={tokenRoute} />;
  }
  if (loading) {
    return (
      <Shell>
        <p>Loading Shortflare…</p>
      </Shell>
    );
  }
  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }
  return <ManagementScreen session={session} onSession={setSession} />;
}

function LoginScreen({ onLogin }: Readonly<{ onLogin: (session: Session) => void }>) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await api("/api/internal/auth/login", { email, password });
    if (!response.ok) {
      setError("Email or password is invalid.");
      return;
    }
    onLogin({ user: response.user as User, csrfToken: String(response.csrfToken) });
  }

  return (
    <Shell>
      <section className="card narrow">
        <p className="eyebrow">Private management</p>
        <h1>Sign in to Shortflare</h1>
        <form onSubmit={submit}>
          <Field label="User Email" value={email} onChange={setEmail} type="email" />
          <Field label="Password" value={password} onChange={setPassword} type="password" />
          {error && <p className="error">{error}</p>}
          <button type="submit">Sign in</button>
        </form>
      </section>
    </Shell>
  );
}

function TokenPasswordScreen({ route }: Readonly<{ route: TokenRoute }>) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState("");
  const title = {
    setup: "Set up the initial Administrator",
    invitation: "Accept your Invitation",
    reset: "Choose a new password",
    recovery: "Recover Administrator access",
  }[route.kind];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setResult("Passwords do not match.");
      return;
    }
    const response = await api(route.endpoint, { token: route.token, password });
    setResult(response.ok ? "Password saved. You can now sign in." : errorMessage(response));
  }

  return (
    <Shell>
      <section className="card narrow">
        <p className="eyebrow">One-time link</p>
        <h1>{title}</h1>
        <p>Use 15–128 characters. Spaces and Unicode are welcome.</p>
        <form onSubmit={submit}>
          <Field label="New password" value={password} onChange={setPassword} type="password" />
          <Field
            label="Confirm password"
            value={confirmation}
            onChange={setConfirmation}
            type="password"
          />
          {result && (
            <p className={result.startsWith("Password saved") ? "success" : "error"}>{result}</p>
          )}
          <button type="submit">Save password</button>
          <a className="secondary-link" href="/">
            Return to sign in
          </a>
        </form>
      </section>
    </Shell>
  );
}

function ManagementScreen({
  session,
  onSession,
}: Readonly<{ session: Session; onSession: (session: Session | undefined) => void }>) {
  const [users, setUsers] = useState<readonly User[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const refreshUsers = useCallback(async () => {
    if (session.user.role !== "administrator") return;
    const response = await api("/api/internal/users");
    if (response.ok) setUsers(response.users as User[]);
  }, [session.user.role]);

  useEffect(() => {
    void refreshUsers();
  }, [refreshUsers]);

  async function mutate(path: string, body: object) {
    setNotice("");
    const response = await api(path, body, session.csrfToken);
    if (!response.ok) {
      setNotice(errorMessage(response));
      return response;
    }
    await refreshUsers();
    return response;
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    const response = await mutate("/api/internal/users/invitations", { email, role });
    if (response?.ok) {
      const token = String((response.invitation as { token: string }).token);
      setLink(`${location.origin}/accept-invitation#token=${encodeURIComponent(token)}`);
      setEmail("");
    }
  }

  async function reauthenticate(event: FormEvent) {
    event.preventDefault();
    const response = await api(
      "/api/internal/auth/reauthenticate",
      { password: reauthPassword },
      session.csrfToken,
    );
    if (!response.ok) {
      setNotice(errorMessage(response));
      return;
    }
    setReauthPassword("");
    onSession({ user: response.user as User, csrfToken: String(response.csrfToken) });
    setNotice("Reauthentication is valid for ten minutes.");
  }

  async function logout() {
    await api("/api/internal/auth/logout", {}, session.csrfToken);
    onSession(undefined);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    const response = await api(
      "/api/internal/auth/password",
      { currentPassword, password: newPassword },
      session.csrfToken,
    );
    if (!response.ok) {
      setNotice(errorMessage(response));
      return;
    }
    onSession(undefined);
  }

  return (
    <Shell>
      <header className="topbar">
        <div>
          <p className="eyebrow">Shortflare management</p>
          <h1>{session.user.email}</h1>
        </div>
        <div className="topbar-actions">
          <span className="badge">{session.user.role}</span>
          <button className="secondary" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      {notice && <p className="notice">{notice}</p>}

      <section className="grid">
        <article className="card">
          <h2>Reauthenticate</h2>
          <p>Required before password resets and Administrator changes.</p>
          <form onSubmit={reauthenticate}>
            <Field
              label="Current password"
              value={reauthPassword}
              onChange={setReauthPassword}
              type="password"
            />
            <button type="submit">Verify password</button>
          </form>
        </article>

        <article className="card">
          <h2>Change password</h2>
          <p>Changing it signs out every browser and device.</p>
          <form onSubmit={changePassword}>
            <Field
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              type="password"
            />
            <Field
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              type="password"
            />
            <button type="submit">Change password</button>
          </form>
        </article>

        {session.user.role === "administrator" && (
          <article className="card">
            <h2>Invite a User</h2>
            <form onSubmit={invite}>
              <Field label="User Email" value={email} onChange={setEmail} type="email" />
              <label>
                Role
                <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                  <option value="administrator">Administrator</option>
                </select>
              </label>
              <button type="submit">Create Invitation</button>
            </form>
          </article>
        )}
      </section>

      {link && <OneTimeLink value={link} />}

      {session.user.role === "administrator" && (
        <section className="card users">
          <h2>Users</h2>
          <div className="user-list">
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                mutate={mutate}
                onLink={(token) =>
                  setLink(`${location.origin}/reset-password#token=${encodeURIComponent(token)}`)
                }
              />
            ))}
          </div>
        </section>
      )}
    </Shell>
  );
}

function UserRow({
  user,
  mutate,
  onLink,
}: Readonly<{
  user: User;
  mutate: (path: string, body: object) => Promise<Record<string, unknown> | undefined>;
  onLink: (token: string) => void;
}>) {
  async function resetPassword() {
    const response = await mutate(`/api/internal/users/${user.id}/password-resets`, {});
    if (response?.ok) {
      onLink(String((response.passwordReset as { token: string }).token));
    }
  }

  return (
    <div className="user-row">
      <div>
        <strong>{user.email}</strong>
        <span>{user.state}</span>
      </div>
      <select
        aria-label={`Role for ${user.email}`}
        value={user.role}
        disabled={user.state === "invited"}
        onChange={(event) =>
          void mutate(`/api/internal/users/${user.id}/role`, {
            role: event.target.value,
          })
        }
      >
        <option value="administrator">Administrator</option>
        <option value="member">Member</option>
        <option value="viewer">Viewer</option>
      </select>
      <div className="row-actions">
        {user.state === "invited" && (
          <button
            className="secondary"
            onClick={() => void mutate(`/api/internal/users/${user.id}/cancel-invitation`, {})}
          >
            Cancel
          </button>
        )}
        {user.state === "active" && (
          <>
            <button className="secondary" onClick={() => void resetPassword()}>
              Reset password
            </button>
            <button
              className="danger"
              onClick={() => void mutate(`/api/internal/users/${user.id}/suspend`, {})}
            >
              Suspend
            </button>
          </>
        )}
        {user.state === "suspended" && (
          <button
            className="secondary"
            onClick={() => void mutate(`/api/internal/users/${user.id}/reactivate`, {})}
          >
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}

function OneTimeLink({ value }: Readonly<{ value: string }>) {
  return (
    <div className="one-time-link">
      <p>Copy now. This link cannot be retrieved later.</p>
      <code>{value}</code>
      <button className="secondary" onClick={() => void navigator.clipboard.writeText(value)}>
        Copy link
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type: "email" | "password";
}>) {
  return (
    <label>
      {label}
      <input
        required
        type={type}
        value={value}
        autoComplete={type === "password" ? "current-password" : "email"}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Shell({ children }: Readonly<{ children: React.ReactNode }>) {
  return <main>{children}</main>;
}

type TokenRoute = Readonly<{
  kind: "setup" | "invitation" | "reset" | "recovery";
  endpoint: string;
  token: string;
}>;

function readTokenRoute(): TokenRoute | undefined {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  const routes: Record<string, Omit<TokenRoute, "token">> = {
    "/setup": { kind: "setup", endpoint: "/api/internal/auth/setup" },
    "/accept-invitation": {
      kind: "invitation",
      endpoint: "/api/internal/auth/invitations/accept",
    },
    "/reset-password": {
      kind: "reset",
      endpoint: "/api/internal/auth/password-resets/use",
    },
    "/operator-recovery": {
      kind: "recovery",
      endpoint: "/api/internal/auth/operator-recovery",
    },
  };
  const route = routes[location.pathname];
  if (!route || !token) return undefined;
  history.replaceState(null, "", location.pathname);
  return { ...route, token };
}

type ApiResponse = { ok: boolean; [key: string]: unknown };

async function api(path: string, body?: object, csrfToken?: string): Promise<ApiResponse> {
  const request: RequestInit = { credentials: "same-origin" };
  if (body) {
    request.method = "POST";
    request.headers = {
      "content-type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    };
    request.body = JSON.stringify(body);
  }
  const response = await fetch(path, request);
  if (response.status === 204) return { ok: true };
  return (await response.json()) as ApiResponse;
}

function errorMessage(response: Record<string, unknown>) {
  switch (response.kind) {
    case "reauthentication-required":
      return "Reauthenticate before this action.";
    case "last-active-administrator":
      return "The last Active Administrator cannot be changed.";
    case "invalid-or-expired-token":
      return "This one-time link is invalid or expired.";
    case "invalid-password":
      return "Use a longer password that is not commonly compromised.";
    default:
      return "The action could not be completed.";
  }
}
