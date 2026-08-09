import { z } from "zod";

export type CloudflareApiFailure = Readonly<{
  ok: false;
  kind:
    | "cloudflare-authentication"
    | "cloudflare-authorization"
    | "cloudflare-conflict"
    | "cloudflare-transient"
    | "cloudflare-invalid-response";
  status: number;
  retryable: boolean;
}>;

export type D1Database = Readonly<{ id: string; name: string }>;
export type CloudflareQueue = Readonly<{
  id: string;
  name: string;
  settings: Readonly<{
    deliveryDelay: number;
    deliveryPaused: boolean;
    messageRetentionPeriod: number;
  }>;
}>;

export type CloudflareApi = Readonly<{
  listD1Databases(
    accountId: string,
    name: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; databases: readonly D1Database[] }>>;
  createD1Database(
    accountId: string,
    name: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; database: D1Database }>>;
  queryD1(
    accountId: string,
    databaseId: string,
    sql: string,
    parameters?: readonly string[],
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; rows: readonly unknown[] }>>;
  listQueues(
    accountId: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; queues: readonly CloudflareQueue[] }>>;
  createQueue(
    accountId: string,
    name: string,
    messageRetentionPeriod: number,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; queue: CloudflareQueue }>>;
  updateQueueRetention(
    accountId: string,
    queue: CloudflareQueue,
    messageRetentionPeriod: number,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; queue: CloudflareQueue }>>;
}>;

const d1Schema = z.looseObject({ uuid: z.string().min(1), name: z.string().min(1) });
const queueSchema = z.looseObject({
  queue_id: z.string().min(1),
  queue_name: z.string().min(1),
  settings: z.looseObject({
    delivery_delay: z.number(),
    delivery_paused: z.boolean(),
    message_retention_period: z.number(),
  }),
});
const d1QuerySchema = z.looseObject({
  success: z.literal(true),
  results: z.array(z.unknown()).optional(),
});

export function createCloudflareApi(
  input: Readonly<{
    apiToken: string;
    fetch?: typeof globalThis.fetch;
    baseUrl?: string;
  }>,
): CloudflareApi {
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const baseUrl = input.baseUrl ?? "https://api.cloudflare.com/client/v4";

  async function request<Result>(
    method: "GET" | "POST" | "PUT",
    resourcePath: string,
    resultSchema: z.ZodType<Result>,
    body?: unknown,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; result: Result }>> {
    let response: Response;
    try {
      response = await fetchImplementation(`${baseUrl}${resourcePath}`, {
        method,
        headers: {
          authorization: `Bearer ${input.apiToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return { ok: false, kind: "cloudflare-transient", status: 0, retryable: true };
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) return failureForStatus(response.status);
    const envelope = z
      .looseObject({ success: z.literal(true), result: resultSchema })
      .safeParse(payload);
    if (!envelope.success) {
      return {
        ok: false,
        kind: "cloudflare-invalid-response",
        status: response.status,
        retryable: false,
      };
    }
    return { ok: true, result: envelope.data.result };
  }

  return {
    async listD1Databases(accountId, name) {
      const response = await request(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/d1/database?name=${encodeURIComponent(name)}`,
        z.array(d1Schema),
      );
      if (!response.ok) return response;
      return {
        ok: true,
        databases: response.result.map((database) => ({
          id: database.uuid,
          name: database.name,
        })),
      };
    },

    async createD1Database(accountId, name) {
      const response = await request(
        "POST",
        `/accounts/${encodeURIComponent(accountId)}/d1/database`,
        d1Schema,
        { name },
      );
      if (!response.ok) return response;
      return { ok: true, database: { id: response.result.uuid, name: response.result.name } };
    },

    async queryD1(accountId, databaseId, sql, parameters = []) {
      const response = await request(
        "POST",
        `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
        z.array(d1QuerySchema),
        { sql, params: parameters },
      );
      if (!response.ok) return response;
      return { ok: true, rows: response.result[0]?.results ?? [] };
    },

    async listQueues(accountId) {
      const response = await request(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/queues`,
        z.array(queueSchema),
      );
      if (!response.ok) return response;
      return { ok: true, queues: response.result.map(toQueue) };
    },

    async createQueue(accountId, name, messageRetentionPeriod) {
      const response = await request(
        "POST",
        `/accounts/${encodeURIComponent(accountId)}/queues`,
        queueSchema,
        {
          queue_name: name,
          settings: { message_retention_period: messageRetentionPeriod },
        },
      );
      if (!response.ok) return response;
      return { ok: true, queue: toQueue(response.result) };
    },

    async updateQueueRetention(accountId, queue, messageRetentionPeriod) {
      const response = await request(
        "PUT",
        `/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queue.id)}`,
        queueSchema,
        {
          queue_name: queue.name,
          settings: {
            delivery_delay: queue.settings.deliveryDelay,
            delivery_paused: queue.settings.deliveryPaused,
            message_retention_period: messageRetentionPeriod,
          },
        },
      );
      if (!response.ok) return response;
      return { ok: true, queue: toQueue(response.result) };
    },
  };
}

function toQueue(queue: z.infer<typeof queueSchema>): CloudflareQueue {
  return {
    id: queue.queue_id,
    name: queue.queue_name,
    settings: {
      deliveryDelay: queue.settings.delivery_delay,
      deliveryPaused: queue.settings.delivery_paused,
      messageRetentionPeriod: queue.settings.message_retention_period,
    },
  };
}

function failureForStatus(status: number): CloudflareApiFailure {
  if (status === 401) {
    return { ok: false, kind: "cloudflare-authentication", status, retryable: false };
  }
  if (status === 403) {
    return { ok: false, kind: "cloudflare-authorization", status, retryable: false };
  }
  if (status === 409) {
    return { ok: false, kind: "cloudflare-conflict", status, retryable: false };
  }
  return {
    ok: false,
    kind: status >= 500 || status === 429 ? "cloudflare-transient" : "cloudflare-invalid-response",
    status,
    retryable: status >= 500 || status === 429,
  };
}
