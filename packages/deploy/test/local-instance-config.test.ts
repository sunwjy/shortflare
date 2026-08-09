import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseInstanceConfig,
  resolveShortflarePaths,
  writeInstanceConfig,
} from "../src/local-instance-config";

describe("local Instance config", () => {
  it("uses platform-standard account-scoped locations", () => {
    expect(
      resolveShortflarePaths({
        platform: "linux",
        homeDirectory: "/home/owner",
        environment: { XDG_CONFIG_HOME: "/config", XDG_DATA_HOME: "/data" },
        accountId: "account-1",
      }),
    ).toEqual({
      configFile: path.join("/config", "shortflare", "accounts", "account-1.json"),
      backupDirectory: path.join("/data", "shortflare", "backups", "account-1"),
    });
    expect(
      resolveShortflarePaths({
        platform: "win32",
        homeDirectory: "C:\\Users\\Owner",
        environment: { APPDATA: "C:\\Roaming", LOCALAPPDATA: "C:\\Local" },
        accountId: "account-1",
      }),
    ).toEqual({
      configFile: path.win32.join("C:\\Roaming", "Shortflare", "accounts", "account-1.json"),
      backupDirectory: path.win32.join("C:\\Local", "Shortflare", "backups", "account-1"),
    });
  });

  it("atomically writes only validated non-secret state with user permissions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "shortflare-config-test-"));
    const configFile = path.join(directory, "nested", "account-1.json");
    const config = {
      formatVersion: 1 as const,
      accountId: "account-1",
      instanceId: "instance-1",
      databaseId: "database-1",
      redirectDomain: "go.example.com",
      coherentRelease: "1.0.0",
    };

    await writeInstanceConfig(configFile, config);

    expect(parseInstanceConfig(JSON.parse(await readFile(configFile, "utf8")))).toEqual({
      ok: true,
      value: config,
    });
    if (process.platform !== "win32") {
      expect((await stat(configFile)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(configFile))).mode & 0o777).toBe(0o700);
    }
  });

  it("rejects secret-shaped and unknown fields", () => {
    expect(
      parseInstanceConfig({
        formatVersion: 1,
        accountId: "account-1",
        instanceId: "instance-1",
        databaseId: "database-1",
        redirectDomain: "go.example.com",
        coherentRelease: "1.0.0",
        apiToken: "must-not-be-cached",
      }),
    ).toMatchObject({ ok: false, kind: "invalid-instance-config" });
  });
});
