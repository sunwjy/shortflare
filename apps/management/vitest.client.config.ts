import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "https://management.test/" },
    },
    include: ["test/client/**/*.test.tsx"],
    setupFiles: ["test/client/setup.ts"],
  },
});
