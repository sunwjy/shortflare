import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const instanceConfigSchema = z.strictObject({
  formatVersion: z.literal(1),
  accountId: identifier,
  instanceId: identifier,
  databaseId: identifier,
  primaryQueueId: identifier.optional(),
  deadLetterQueueId: identifier.optional(),
  redirectDomain: z.string().min(1).max(253),
  managementDomain: z.string().min(1).max(253).optional(),
  coherentRelease: z.string().min(1).max(128),
});

export type InstanceConfig = Readonly<z.infer<typeof instanceConfigSchema>>;

export type ParseInstanceConfigResult =
  | Readonly<{ ok: true; value: InstanceConfig }>
  | Readonly<{
      ok: false;
      kind: "invalid-instance-config";
      issues: readonly Readonly<{ path: string; message: string }>[];
    }>;

export function parseInstanceConfig(input: unknown): ParseInstanceConfigResult {
  const parsed = instanceConfigSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    kind: "invalid-instance-config",
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function resolveShortflarePaths(
  input: Readonly<{
    platform: NodeJS.Platform;
    homeDirectory: string;
    environment: Readonly<Record<string, string | undefined>>;
    accountId: string;
    configOverride?: string;
    backupOverride?: string;
  }>,
): Readonly<{ configFile: string; backupDirectory: string }> {
  if (!identifier.safeParse(input.accountId).success) {
    throw new Error("Cloudflare account ID is not safe for a local path");
  }

  const pathImplementation = input.platform === "win32" ? path.win32 : path.posix;
  const defaults = defaultBaseDirectories(input, pathImplementation);
  return {
    configFile:
      input.configOverride ??
      pathImplementation.join(defaults.config, "accounts", `${input.accountId}.json`),
    backupDirectory:
      input.backupOverride ?? pathImplementation.join(defaults.data, "backups", input.accountId),
  };
}

export async function writeInstanceConfig(filePath: string, config: InstanceConfig): Promise<void> {
  const parsed = parseInstanceConfig(config);
  if (!parsed.ok) {
    throw new Error("Refusing to write an invalid local Instance config");
  }

  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(parsed.value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } catch (error: unknown) {
    await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function defaultBaseDirectories(
  input: Readonly<{
    platform: NodeJS.Platform;
    homeDirectory: string;
    environment: Readonly<Record<string, string | undefined>>;
  }>,
  pathImplementation: typeof path.posix,
): Readonly<{ config: string; data: string }> {
  if (input.platform === "win32") {
    return {
      config:
        input.environment.APPDATA === undefined
          ? pathImplementation.join(input.homeDirectory, "AppData", "Roaming", "Shortflare")
          : pathImplementation.join(input.environment.APPDATA, "Shortflare"),
      data:
        input.environment.LOCALAPPDATA === undefined
          ? pathImplementation.join(input.homeDirectory, "AppData", "Local", "Shortflare")
          : pathImplementation.join(input.environment.LOCALAPPDATA, "Shortflare"),
    };
  }
  if (input.platform === "darwin") {
    const applicationSupport = pathImplementation.join(
      input.homeDirectory,
      "Library",
      "Application Support",
      "Shortflare",
    );
    return { config: applicationSupport, data: applicationSupport };
  }
  return {
    config:
      input.environment.XDG_CONFIG_HOME === undefined
        ? pathImplementation.join(input.homeDirectory, ".config", "shortflare")
        : pathImplementation.join(input.environment.XDG_CONFIG_HOME, "shortflare"),
    data:
      input.environment.XDG_DATA_HOME === undefined
        ? pathImplementation.join(input.homeDirectory, ".local", "share", "shortflare")
        : pathImplementation.join(input.environment.XDG_DATA_HOME, "shortflare"),
  };
}
