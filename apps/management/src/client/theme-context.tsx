import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { Theme } from "./theme";

type ThemeContextValue = Readonly<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>;

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({
  theme,
  setTheme,
  children,
}: Readonly<ThemeContextValue & { children: ReactNode }>) {
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider.");
  return context;
}
