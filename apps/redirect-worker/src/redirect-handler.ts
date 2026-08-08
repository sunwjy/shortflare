import type { ClickAnalytics } from "@shortflare/analytics";
import { createD1LinksPersistence } from "@shortflare/database";
import { createLinks, mergeDestinationQuery, type RedirectDecision } from "@shortflare/links";
import type { Context } from "hono";

export type RedirectWorkerEnvironment = {
  Bindings: {
    ANALYTICS_HMAC_KEY: string;
    ANALYTICS_QUEUE: Queue;
    DB: D1Database;
  };
};

type CachedDecision = RedirectDecision | undefined;

/**
 * Resolves one Alias while treating the data-center cache as best effort.
 * Cache failures never block D1 resolution, D1 failures return 503, and cache
 * writes run after the response through the Worker's execution context.
 */
export async function handleRedirect(
  context: Context<RedirectWorkerEnvironment>,
  alias: string,
  createClickAnalytics: (bindings: RedirectWorkerEnvironment["Bindings"]) => ClickAnalytics,
) {
  const url = new URL(context.req.url);
  const cacheKey = createResolutionCacheKey(url, alias);
  let decision: CachedDecision;

  try {
    decision = await readCachedDecision(caches.default, cacheKey);
  } catch (error) {
    console.error("Failed to read the Alias resolution cache", error);
  }

  if (decision === undefined) {
    const links = createLinks({
      persistence: createD1LinksPersistence(context.env.DB),
      redirectDomain: url.hostname,
    });
    try {
      decision = await links.resolve(alias);
    } catch (error) {
      console.error("Failed to resolve an Alias from D1", error);
      return context.body(null, 503, {
        "cache-control": "no-store",
      });
    }

    context.executionCtx.waitUntil(
      cacheDecision(caches.default, cacheKey, decision).catch((error: unknown) => {
        console.error("Failed to write the Alias resolution cache", error);
      }),
    );
  }

  if (decision.kind !== "redirect") {
    return context.body(null, decision.kind === "gone" ? 410 : 404, {
      "cache-control": "no-store",
    });
  }
  context.header("cache-control", "no-store");
  if (context.req.method === "GET") {
    scheduleClickAnalytics(context, decision, createClickAnalytics);
  }
  return context.redirect(mergeDestinationQuery(decision.destination, url.search.slice(1)), 302);
}

function scheduleClickAnalytics(
  context: Context<RedirectWorkerEnvironment>,
  decision: Extract<RedirectDecision, { kind: "redirect" }>,
  factory: (bindings: RedirectWorkerEnvironment["Bindings"]) => ClickAnalytics,
) {
  try {
    const analytics = factory(context.env);
    const country = context.req.raw.cf?.country;
    context.executionCtx.waitUntil(
      analytics
        .record({
          linkId: decision.linkId,
          destinationVersionId: decision.destinationVersionId,
          clientIp: context.req.header("cf-connecting-ip") ?? null,
          userAgent: context.req.header("user-agent") ?? null,
          referrer: context.req.header("referer") ?? null,
          country: typeof country === "string" ? country : null,
        })
        .catch((error: unknown) => {
          console.error("Failed to emit a Click Event", error);
        }),
    );
  } catch (error) {
    // Analytics configuration is deliberately outside the redirect availability path.
    console.error("Failed to initialize Click Analytics", error);
  }
}

function createResolutionCacheKey(requestUrl: URL, alias: string): Request {
  const cacheUrl = new URL(requestUrl.origin);
  cacheUrl.pathname = `/.shortflare/cache/aliases/${encodeURIComponent(alias)}`;
  return new Request(cacheUrl, { method: "GET" });
}

async function readCachedDecision(cache: Cache, key: Request): Promise<CachedDecision> {
  const response = await cache.match(key);
  if (response === undefined) {
    return undefined;
  }
  const value: unknown = await response.json();
  return isRedirectDecision(value) ? value : undefined;
}

async function cacheDecision(
  cache: Cache,
  key: Request,
  decision: RedirectDecision,
): Promise<void> {
  await cache.put(
    key,
    new Response(JSON.stringify(decision), {
      headers: {
        "cache-control": "public, max-age=5",
        "content-type": "application/json",
      },
    }),
  );
}

function isRedirectDecision(value: unknown): value is RedirectDecision {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  if (value.kind === "not-found" || value.kind === "gone") {
    return true;
  }
  return (
    value.kind === "redirect" &&
    "linkId" in value &&
    typeof value.linkId === "string" &&
    "destinationVersionId" in value &&
    typeof value.destinationVersionId === "string" &&
    "destination" in value &&
    typeof value.destination === "string"
  );
}
