import { createD1LinksPersistence } from "@shortflare/database";
import { createLinks } from "@shortflare/links";
import { Hono } from "hono";
import { z } from "zod";

const healthResponse = z.object({ status: z.literal("ok") });
const createLinkRequest = z.strictObject({
  alias: z.string(),
  title: z.string(),
  destination: z.string(),
});

type Bindings = {
  DB: D1Database;
  REDIRECT_DOMAIN: string;
};

export const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/internal/health", (context) => context.json(healthResponse.parse({ status: "ok" })));

if (import.meta.env.DEV) {
  app.post("/api/internal/links", async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ ok: false, kind: "invalid-request" } as const, 400);
    }

    const request = createLinkRequest.safeParse(body);
    if (!request.success) {
      return context.json({ ok: false, kind: "invalid-request" } as const, 400);
    }

    const links = createLinks({
      persistence: createD1LinksPersistence(context.env.DB),
      redirectDomain: context.env.REDIRECT_DOMAIN,
    });
    const result = await links.execute(
      { kind: "create", ...request.data },
      { id: "system:development" },
    );
    if (result.ok) {
      return context.json(result, 201);
    }
    const status = result.kind === "alias-in-use" || result.kind === "alias-reserved" ? 409 : 400;
    return context.json(result, status);
  });
}

export default app;
