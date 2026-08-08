import { createClickAnalytics, type ClickAnalytics } from "@shortflare/analytics";
import { Hono } from "hono";

import { handleRedirect, type RedirectWorkerEnvironment } from "./redirect-handler";

type RedirectDependencies = Readonly<{
  createClickAnalytics(bindings: RedirectWorkerEnvironment["Bindings"]): ClickAnalytics;
}>;

const installationPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Shortflare</title>
  </head>
  <body>Shortflare is installed.</body>
</html>`;

const productionDependencies: RedirectDependencies = {
  createClickAnalytics(bindings) {
    return createClickAnalytics({
      hmacKey: bindings.ANALYTICS_HMAC_KEY,
      delivery: {
        async deliver(event) {
          await bindings.ANALYTICS_QUEUE.send(event);
        },
      },
    });
  },
};

export function createRedirectApp(dependencies: RedirectDependencies = productionDependencies) {
  const app = new Hono<RedirectWorkerEnvironment>();

  app.use("*", async (context, next) => {
    if (context.req.method === "GET" || context.req.method === "HEAD") {
      await next();
      return;
    }
    return context.body(null, 405, {
      allow: "GET, HEAD",
      "cache-control": "no-store",
    });
  });

  app.get("/", (context) => {
    context.header("cache-control", "no-store");
    context.header("x-robots-tag", "noindex, nofollow");
    return context.html(installationPage);
  });

  app.get("/:alias", (context) =>
    handleRedirect(context, context.req.param("alias"), dependencies.createClickAnalytics),
  );

  app.notFound((context) =>
    context.body(null, 404, {
      "cache-control": "no-store",
    }),
  );

  app.onError((error, context) => {
    console.error("Unexpected Redirect Worker failure", error);
    return context.body(null, 500, {
      "cache-control": "no-store",
    });
  });

  return app;
}

const app = createRedirectApp();

export default app;
