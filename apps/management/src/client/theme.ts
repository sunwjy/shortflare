export type Theme = "light" | "dark" | "system";

const themeStorageKey = "shortflare-theme";

export function readTheme(): Theme {
  const stored = window.localStorage.getItem(themeStorageKey);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export function applyTheme(theme: Theme) {
  window.localStorage.setItem(themeStorageKey, theme);
  document.documentElement.dataset.theme = theme;
}
