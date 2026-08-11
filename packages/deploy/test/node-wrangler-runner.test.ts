import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { createNodeWranglerRun } from "../src/node-wrangler-runner";

describe("Node Wrangler process runner", () => {
  it("invokes the pinned module without a shell and sends secret input through stdin", async () => {
    let invocation:
      | Readonly<{ command: string; arguments: readonly string[]; shell?: boolean }>
      | undefined;
    const run = createNodeWranglerRun({
      executable: "/node",
      wranglerModule: "/package/wrangler.js",
      spawn: (command, arguments_, options) => {
        invocation = { command, arguments: arguments_, shell: options.shell };
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          stdin: PassThrough;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdin = new PassThrough();
        queueMicrotask(() => child.emit("close", 0));
        return child;
      },
    });

    await expect(run(["secret", "put", "KEY"], { stdin: "secret" })).resolves.toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(invocation).toEqual({
      command: "/node",
      arguments: ["/package/wrangler.js", "secret", "put", "KEY"],
      shell: false,
    });
  });
});
