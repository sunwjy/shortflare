import { app } from "./app";
import { consumeAnalytics } from "./analytics-queue";
import type { ManagementBindings } from "./environment";

export { app };

export const worker = {
  fetch(request: Request, bindings: ManagementBindings, context: ExecutionContext) {
    return app.fetch(request, bindings, context);
  },
  async queue(batch: MessageBatch<unknown>, bindings: ManagementBindings) {
    await consumeAnalytics(batch, bindings);
  },
};

export default worker;
