import type { Theme } from "../theme";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";

export function ThemeField({
  theme,
  onTheme,
  className = "",
}: Readonly<{ theme: Theme; onTheme: (theme: Theme) => void; className?: string }>) {
  return (
    <label className={`grid gap-1 text-xs text-muted-foreground ${className}`}>
      Theme
      <NativeSelect
        className="w-full"
        aria-label="Theme"
        value={theme}
        onChange={(event) => onTheme(event.target.value as Theme)}
      >
        <NativeSelectOption value="system">System</NativeSelectOption>
        <NativeSelectOption value="light">Light</NativeSelectOption>
        <NativeSelectOption value="dark">Dark</NativeSelectOption>
      </NativeSelect>
    </label>
  );
}
