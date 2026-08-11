import { describe, expect, it } from "vitest";

import { parseCliArguments } from "../src/cli-contract";

describe("Shortflare CLI contract", () => {
  it("parses a prompt-free JSON deployment", () => {
    expect(
      parseCliArguments([
        "deploy",
        "--json",
        "--yes",
        "--account-id",
        "account-1",
        "--redirect-domain",
        "go.example.com",
        "--administrator-email",
        "owner@example.com",
      ]),
    ).toEqual({
      ok: true,
      command: {
        kind: "deploy",
        mode: "json",
        approval: { kind: "non-destructive" },
        dryRun: false,
        setupTokenFromStdin: false,
        accountId: "account-1",
        redirectDomain: "go.example.com",
        administratorEmail: "owner@example.com",
      },
    });
  });

  it("requires explicit non-interactive approval unless deployment is a dry run", () => {
    expect(parseCliArguments(["deploy", "--json"])).toEqual({
      ok: false,
      exitCode: 4,
      error: {
        kind: "approval-required",
        message: "JSON deployment requires --yes or --dry-run",
      },
    });
    expect(parseCliArguments(["deploy", "--json", "--dry-run"])).toMatchObject({
      ok: true,
      command: { kind: "deploy", mode: "json", approval: { kind: "none" }, dryRun: true },
    });
  });

  it("binds destructive approval to an exact plan digest", () => {
    expect(
      parseCliArguments(["deploy", "--json", "--approve-digest", "a".repeat(64)]),
    ).toMatchObject({
      ok: true,
      command: {
        kind: "deploy",
        mode: "json",
        approval: { kind: "plan-digest", digest: "a".repeat(64) },
      },
    });
  });

  it("keeps diagnosis read-only and recovery explicitly named", () => {
    expect(parseCliArguments(["diagnose", "--json", "--account-id", "account-1"])).toEqual({
      ok: true,
      command: { kind: "diagnose", mode: "json", accountId: "account-1" },
    });
    expect(parseCliArguments(["recover", "--json"])).toEqual({
      ok: false,
      exitCode: 2,
      error: {
        kind: "invalid-input",
        message: "recover requires a named recovery action",
      },
    });
    expect(parseCliArguments(["recover", "orphan-resources", "--json"])).toEqual({
      ok: false,
      exitCode: 2,
      error: {
        kind: "invalid-input",
        message: "orphan-resources requires --resource",
      },
    });
    expect(
      parseCliArguments(["recover", "orphan-resources", "--json", "--resource", "primary-queue"]),
    ).toEqual({
      ok: true,
      command: {
        kind: "recover",
        mode: "json",
        action: "orphan-resources",
        approval: { kind: "none" },
        secretFromStdin: false,
        resource: "primary-queue",
      },
    });
    expect(
      parseCliArguments([
        "recover",
        "orphan-resources",
        "--json",
        "--resource",
        "primary-queue",
        "--approve-digest",
        "b".repeat(64),
      ]),
    ).toMatchObject({
      ok: true,
      command: { approval: { kind: "plan-digest", digest: "b".repeat(64) } },
    });
    expect(
      parseCliArguments(["recover", "orphan-resources", "--resource", "primary-queue", "--yes"]),
    ).toMatchObject({
      ok: false,
      error: { message: "Recovery approval must use --approve-digest, not --yes" },
    });
  });

  it("reports invalid input without leaking parser internals", () => {
    expect(parseCliArguments(["deploy", "--unknown"])).toEqual({
      ok: false,
      exitCode: 2,
      error: {
        kind: "invalid-input",
        message: "Unknown option '--unknown'",
      },
    });
  });
});
