import { createAnalytics } from "@shortflare/analytics";
import { createD1AnalyticsPersistence } from "@shortflare/database";

import type { ManagementBindings } from "./environment";

export async function consumeAnalytics(batch: MessageBatch<unknown>, bindings: ManagementBindings) {
  const analytics = createAnalytics({
    persistence: createD1AnalyticsPersistence(bindings.DB),
  });
  const results = await analytics.ingest(batch.messages.map(({ body }) => body));
  for (const [index, result] of results.entries()) {
    const message = batch.messages[index];
    if (message === undefined) {
      throw new Error("Analytics ingestion returned an unexpected result count");
    }
    if (result.kind === "ingested" || result.kind === "duplicate") {
      message.ack();
    } else {
      message.retry();
    }
  }
}
