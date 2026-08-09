import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Analytics Queue deployment configuration", () => {
  it("routes exhausted retries to the DLQ with the confirmed batch policy", () => {
    const configuration = readFileSync("wrangler.jsonc", "utf8");
    const consumer = configuration.slice(
      configuration.indexOf('"consumers"'),
      configuration.indexOf('"triggers"'),
    );

    expect(consumer).toContain('"dead_letter_queue": "shortflare-events-dlq"');
    expect(consumer).toContain('"max_batch_size": 10');
    expect(consumer).toContain('"max_batch_timeout": 1');
    expect(consumer).toContain('"max_concurrency": 1');
    expect(consumer).toContain('"max_retries": 3');
    expect(consumer).toContain('"retry_delay": 60');
  });
});
