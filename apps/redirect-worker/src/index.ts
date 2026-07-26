import { Hono } from "hono";

import { handleRedirect, type RedirectWorkerEnvironment } from "./redirect-handler";

const app = new Hono<RedirectWorkerEnvironment>();
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

app.get("/:alias", (context) => handleRedirect(context, context.req.param("alias")));

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

export default app;
