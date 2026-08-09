import { createAnalytics } from "@shortflare/analytics";
import { createD1AnalyticsPersistence } from "@shortflare/database";

import type { ManagementBindings } from "./environment";

export async function expireAnalytics(bindings: ManagementBindings, scheduledTime: number) {
  const analytics = createAnalytics({
    persistence: createD1AnalyticsPersistence(bindings.DB),
    // Retention follows the event's scheduled timestamp so delayed delivery and
    // custom Cron expressions cannot move the cutoff to execution wall time.
    now: () => new Date(scheduledTime),
  });
  const result = await analytics.execute({ kind: "expire" });
  if (result.kind !== "completed") {
    throw new Error("Analytics retention returned an unexpected result");
  }
}
