import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default function buildManagementWorker() {
  const redirectWorkerDirectory = path.dirname(fileURLToPath(import.meta.url));
  const managementDirectory = path.resolve(redirectWorkerDirectory, "../management");
  const commandEnvironment = {
    ...process.env,
    XDG_CONFIG_HOME: "/tmp/shortflare-wrangler-config",
    WRANGLER_LOG_PATH: "/tmp/shortflare-wrangler.log",
    WRANGLER_SEND_METRICS: "false",
  };

  execFileSync(path.resolve(managementDirectory, "node_modules/.bin/vite"), ["build"], {
    cwd: managementDirectory,
    env: commandEnvironment,
    stdio: "inherit",
  });

  execFileSync(
    path.resolve(managementDirectory, "node_modules/.bin/wrangler"),
    [
      "deploy",
      "--dry-run",
      "--outdir",
      path.resolve(redirectWorkerDirectory, ".wrangler/integration/management"),
    ],
    {
      cwd: managementDirectory,
      env: commandEnvironment,
      stdio: "inherit",
    },
  );
}
