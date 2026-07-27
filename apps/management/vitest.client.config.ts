import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "https://management.test/" },
    },
    include: ["test/client/**/*.test.tsx"],
    setupFiles: ["test/client/setup.ts"],
  },
});
