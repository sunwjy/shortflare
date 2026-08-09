import { app } from "./app";
import { consumeAnalytics } from "./analytics-queue";
import { expireAnalytics } from "./analytics-retention";
import type { ManagementBindings } from "./environment";

export { app };

export const worker = {
  fetch(request: Request, bindings: ManagementBindings, context: ExecutionContext) {
    return app.fetch(request, bindings, context);
  },
  async queue(batch: MessageBatch<unknown>, bindings: ManagementBindings) {
    await consumeAnalytics(batch, bindings);
  },
  async scheduled(controller: ScheduledController, bindings: ManagementBindings) {
    await expireAnalytics(bindings, controller.scheduledTime);
  },
};

export default worker;
