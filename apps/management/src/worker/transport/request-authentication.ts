import type { User } from "../identity";

export type RequestAuthentication = Readonly<{
  authenticateSafe(
    sessionToken: string,
  ): Promise<Readonly<{ ok: true; user: User }> | Readonly<{ ok: false; kind: "unauthenticated" }>>;
  authenticateMutation(
    input: Readonly<{
      sessionToken: string;
      csrfToken: string;
    }>,
  ): Promise<
    | Readonly<{ ok: true; user: User; recentlyAuthenticated: boolean }>
    | Readonly<{ ok: false; kind: "unauthenticated" | "invalid-csrf-token" }>
  >;
}>;
