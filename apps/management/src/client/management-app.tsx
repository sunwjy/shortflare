import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";

import { createManagementRouter } from "./management-router";
import type { Theme } from "./theme";
import { ThemeProvider } from "./theme-context";
import type { Session } from "./types";

export function ManagementApp({
  session,
  onSession,
  theme,
  onTheme,
}: Readonly<{
  session: Session;
  onSession: (session: Session | undefined) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
}>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 15_000 },
          mutations: { retry: false },
        },
      }),
  );
  const [router] = useState(createManagementRouter);

  return (
    <ThemeProvider theme={theme} setTheme={onTheme}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} context={{ session, onSession, queryClient }} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
