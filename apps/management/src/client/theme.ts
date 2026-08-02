export type Theme = "light" | "dark" | "system";

const themeStorageKey = "shortflare-theme";

export function readTheme(): Theme {
  const stored = window.localStorage.getItem(themeStorageKey);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export function applyTheme(theme: Theme) {
  window.localStorage.setItem(themeStorageKey, theme);
  const media =
    theme === "system" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : undefined;
  const root = document.documentElement;

  function syncTheme() {
    const dark = theme === "dark" || (theme === "system" && media?.matches === true);
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
  }

  syncTheme();
  media?.addEventListener("change", syncTheme);
  return () => media?.removeEventListener("change", syncTheme);
}
