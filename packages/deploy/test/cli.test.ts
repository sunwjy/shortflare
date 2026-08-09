import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli";

describe("shortflare command entrypoint", () => {
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
      { nodeVersion: "22.11.0" },
    );

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("Node.js >=22.12.0 is required");
  });
});
