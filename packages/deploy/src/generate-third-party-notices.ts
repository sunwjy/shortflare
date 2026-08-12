import { writeWorkspaceThirdPartyNotices } from "./workspace-package-surface.js";

if (process.argv[2] !== "--write" || process.argv.length !== 3) {
  throw new Error("Usage: node dist/generate-third-party-notices.js --write");
}

await writeWorkspaceThirdPartyNotices();
