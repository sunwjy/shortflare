export function createTestExecutionContext() {
  const pending: Promise<unknown>[] = [];
  const executionContext = {
    passThroughOnException() {},
    props: {},
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  } as ExecutionContext;
  return {
    executionContext,
    waitForPending: () => Promise.all(pending),
  };
}
