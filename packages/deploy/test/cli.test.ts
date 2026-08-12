import { describe, expect, it } from "vitest";

import { renderCliHelp, renderCliVersion, runCli } from "../src/cli";

describe("shortflare command entrypoint", () => {
  it("links help to documentation for the exact release", () => {
    expect(renderCliHelp("0.1.0")).toContain(
      "https://github.com/sunwjy/shortflare/blob/v0.1.0/docs/deployment.md",
    );
    expect(renderCliHelp("0.1.0")).not.toContain("docs/deployment.md for complete options");
  });

  it("renders the exact installed package version for informational output", () => {
    expect(renderCliVersion("0.1.0")).toBe("0.1.0\n");
  });

  it("writes exactly one versioned JSON result to stdout", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["diagnose", "--json", "--account-id", "account-1"],
      {
        async deploy() {
          throw new Error("not called");
        },
        async diagnose() {
          return { ok: true, formatVersion: 1, finalState: "coherent" };
        },
        async recover() {
          throw new Error("not called");
        },
      },
      { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['{"ok":true,"formatVersion":1,"finalState":"coherent"}\n']);
    expect(stderr).toEqual([]);
  });

  it("returns stable parse failures without invoking application effects", async () => {
    let invoked = false;
    const stdout: string[] = [];
    const exitCode = await runCli(
      ["deploy", "--json"],
      {
        async deploy() {
          invoked = true;
          return { ok: true };
        },
        async diagnose() {
          invoked = true;
          return { ok: true };
        },
        async recover() {
          invoked = true;
          return { ok: true };
        },
      },
      { stdout: (text) => stdout.push(text), stderr: () => undefined },
    );

    expect(exitCode).toBe(4);
    expect(invoked).toBe(false);
    expect(JSON.parse(stdout.join(""))).toEqual({
      ok: false,
      formatVersion: 1,
      error: {
        kind: "approval-required",
        message: "JSON deployment requires --yes or --dry-run",
      },
    });
  });

  it("prints both live addresses and the one-time setup token after install", async () => {
    const stdout: string[] = [];
    const exitCode = await runCli(
      ["deploy", "--yes", "--account-id", "account-1", "--redirect-domain", "go.example.com"],
      {
        async deploy() {
          return {
            ok: true,
            managementAddress: "https://shortflare-management.owner.workers.dev",
            redirectAddress: "https://go.example.com",
            setupToken: "setup-token",
          };
        },
        async diagnose() {
          throw new Error("not called");
        },
        async recover() {
          throw new Error("not called");
        },
      },
      { stdout: (text) => stdout.push(text), stderr: () => undefined },
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain(
      "Management: https://shortflare-management.owner.workers.dev",
    );
    expect(stdout.join("\n")).toContain("Redirect: https://go.example.com");
    expect(stdout.join("\n")).toContain("One-time setup token: setup-token");
  });

  it("rejects unsupported Node before accessing the application", async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(
      ["diagnose"],
      {
        async deploy() {
          throw new Error("not called");
        },
        async diagnose() {
          throw new Error("not called");
        },
        async recover() {
          throw new Error("not called");
        },
      },
      { stdout: () => undefined, stderr: (text) => stderr.push(text) },
      { nodeVersion: "22.12.0" },
    );

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("Node.js >=22.13.0 is required");
  });

  it("accepts the minimum supported Node version", async () => {
    const exitCode = await runCli(
      ["diagnose", "--json", "--account-id", "account-1"],
      {
        async deploy() {
          throw new Error("not called");
        },
        async diagnose() {
          return { ok: true };
        },
        async recover() {
          throw new Error("not called");
        },
      },
      { stdout: () => undefined, stderr: () => undefined },
      { nodeVersion: "22.13.0" },
    );

    expect(exitCode).toBe(0);
  });
});
