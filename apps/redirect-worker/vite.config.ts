import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  build: { license: { fileName: ".vite/license.json" } },
  plugins: [cloudflare()],
});
