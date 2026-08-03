import type { QueryClient } from "@tanstack/react-query";

import type { Session } from "./types";

export type ManagementRouterContext = Readonly<{
  session: Session;
  onSession: (session: Session | undefined) => void;
  queryClient: QueryClient;
}>;
