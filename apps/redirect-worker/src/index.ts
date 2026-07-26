import { Hono } from "hono";

const app = new Hono();

app.get("/", (context) => context.text("Shortflare is installed."));

export default app;
