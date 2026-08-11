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
  resource?: string;
  requiredPermission?: string;
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
  producers: readonly Readonly<{ script: string; type: string }>[];
  consumers: readonly Readonly<{
    id: string;
    scriptName: string;
    type: string;
    deadLetterQueue: string;
    maxRetries?: number;
    maxBatchSize?: number;
    maxBatchTimeout?: number;
    maxConcurrency?: number;
    retryDelay?: number;
  }>[];
}>;
export type WorkerDomain = Readonly<{ id: string; hostname: string; worker: string }>;
export type WorkerScript = Readonly<{ name: string }>;
export type WorkerBinding = Readonly<{
  name: string;
  type: string;
  databaseId?: string;
  queueName?: string;
}>;
export type HostnameAttachment = Readonly<{
  kind: "dns" | "pages" | "route";
  owner: string;
}>;

export type CloudflareApi = Readonly<{
  inspectHostnameAttachments?(
    accountId: string,
    hostname: string,
  ): Promise<
    CloudflareApiFailure | Readonly<{ ok: true; attachments: readonly HostnameAttachment[] }>
  >;
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
    parameters?: readonly (string | null)[],
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; rows: readonly unknown[] }>>;
  beginD1Export(
    accountId: string,
    databaseId: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; bookmark: string }>>;
  pollD1Export(
    accountId: string,
    databaseId: string,
    bookmark: string,
  ): Promise<
    | CloudflareApiFailure
    | Readonly<{ ok: true; state: "pending" }>
    | Readonly<{ ok: true; state: "ready"; downloadUrl: string }>
  >;
  getWorkersSubdomain(
    accountId: string,
  ): Promise<
    | CloudflareApiFailure
    | Readonly<{ ok: true; registered: false }>
    | Readonly<{ ok: true; registered: true; subdomain: string }>
  >;
  listWorkerDomains(
    accountId: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; domains: readonly WorkerDomain[] }>>;
  attachWorkerDomain(
    accountId: string,
    hostname: string,
    workerName: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; domain: WorkerDomain }>>;
  deleteWorkerDomain(
    accountId: string,
    domainId: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true }>>;
  listWorkerSecretNames(
    accountId: string,
    workerName: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; names: readonly string[] }>>;
  listWorkerScripts(
    accountId: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; scripts: readonly WorkerScript[] }>>;
  listWorkerBindings(
    accountId: string,
    workerName: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; bindings: readonly WorkerBinding[] }>>;
  listActiveWorkerVersions(
    accountId: string,
    workerName: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true; versionIds: readonly string[] }>>;
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
  deleteQueueConsumer(
    accountId: string,
    queueId: string,
    consumerId: string,
  ): Promise<CloudflareApiFailure | Readonly<{ ok: true }>>;
}>;

const d1Schema = z.looseObject({ uuid: z.string().min(1), name: z.string().min(1) });
const queueSchema = z.looseObject({
  queue_id: z.string().min(1),
  queue_name: z.string().min(1),
  settings: z.looseObject({
    delivery_delay: z.number(),
    delivery_paused: z.boolean().default(false),
    message_retention_period: z.number(),
  }),
  producers: z
    .array(z.looseObject({ script: z.string().min(1), type: z.string().min(1) }))
    .optional(),
  consumers: z
    .array(
      z.looseObject({
        consumer_id: z.string().min(1),
        script_name: z.string().min(1),
        type: z.string().min(1),
        dead_letter_queue: z.string(),
        settings: z
          .looseObject({
            max_retries: z.number().optional(),
            batch_size: z.number().optional(),
            max_batch_size: z.number().optional(),
            max_wait_time_ms: z.number().optional(),
            max_batch_timeout: z.number().optional(),
            max_concurrency: z.number().optional(),
            retry_delay: z.number().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
const d1QuerySchema = z.looseObject({
  success: z.literal(true),
  results: z.array(z.unknown()).optional(),
});
const d1ExportSchema = z.looseObject({
  at_bookmark: z.string().optional(),
  signed_url: z.url().optional(),
});
const workersSubdomainSchema = z.looseObject({ subdomain: z.string().min(1) });
const workerDomainSchema = z.looseObject({
  id: z.string().min(1),
  hostname: z.string().min(1),
  service: z.string().min(1),
});
const workerSecretSchema = z.looseObject({ name: z.string().min(1), type: z.string() });
const workerScriptSchema = z.looseObject({ id: z.string().min(1) });
const workerBindingSchema = z.looseObject({
  name: z.string().min(1),
  type: z.string().min(1),
  database_id: z.string().optional(),
  queue_name: z.string().optional(),
});
const workerDeploymentsSchema = z.looseObject({
  deployments: z.array(
    z.looseObject({
      versions: z.array(z.looseObject({ version_id: z.string().min(1) })),
    }),
  ),
});
const zoneSchema = z.looseObject({ id: z.string().min(1), name: z.string().min(1) });
const dnsRecordSchema = z.looseObject({ name: z.string().min(1), type: z.string().min(1) });
const workerRouteSchema = z.looseObject({
  pattern: z.string().min(1),
  script: z.string().nullable().optional(),
});
const pagesProjectSchema = z.looseObject({
  name: z.string().min(1),
  domains: z.array(z.string()).optional(),
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
    method: "DELETE" | "GET" | "POST" | "PUT",
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
    if (!response.ok) return failureForStatus(response.status, resourcePath, method);
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
    async inspectHostnameAttachments(accountId, hostname) {
      const zones = await request(
        "GET",
        `/zones?account.id=${encodeURIComponent(accountId)}&per_page=50`,
        z.array(zoneSchema),
      );
      if (!zones.ok) return zones;
      const zone = zones.result
        .filter(
          (candidate) => hostname === candidate.name || hostname.endsWith(`.${candidate.name}`),
        )
        .toSorted((left, right) => right.name.length - left.name.length)[0];
      if (zone === undefined) {
        return { ok: true, attachments: [] };
      }
      const pagesProjects = async (
        page = 1,
        projects: z.infer<typeof pagesProjectSchema>[] = [],
      ): Promise<
        { ok: true; result: z.infer<typeof pagesProjectSchema>[] } | CloudflareApiFailure
      > => {
        const response = await request(
          "GET",
          `/accounts/${encodeURIComponent(accountId)}/pages/projects?per_page=10&page=${page}`,
          z.array(pagesProjectSchema),
        );
        if (!response.ok) return response;
        const accumulated = [...projects, ...response.result];
        return response.result.length < 10
          ? { ok: true, result: accumulated }
          : pagesProjects(page + 1, accumulated);
      };
      const [records, routes, projects] = await Promise.all([
        request(
          "GET",
          `/zones/${encodeURIComponent(zone.id)}/dns_records?name.exact=${encodeURIComponent(hostname)}&per_page=100`,
          z.array(dnsRecordSchema),
        ),
        request(
          "GET",
          `/zones/${encodeURIComponent(zone.id)}/workers/routes`,
          z.array(workerRouteSchema),
        ),
        pagesProjects(),
      ]);
      if (!records.ok) return records;
      if (!routes.ok) return routes;
      if (!projects.ok) return projects;
      return {
        ok: true,
        attachments: [
          ...records.result.map((record) => ({
            kind: "dns" as const,
            owner: record.type,
          })),
          ...routes.result
            .filter((route) => routePatternCoversHostname(route.pattern, hostname))
            .map((route) => ({ kind: "route" as const, owner: route.script ?? "route" })),
          ...projects.result
            .filter((project) => project.domains?.includes(hostname) === true)
            .map((project) => ({ kind: "pages" as const, owner: project.name })),
        ],
      };
    },
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

    async beginD1Export(accountId, databaseId) {
      const response = await request(
        "POST",
        `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/export`,
        d1ExportSchema,
        { output_format: "polling" },
      );
      if (!response.ok) return response;
      if (response.result.at_bookmark === undefined) {
        return {
          ok: false,
          kind: "cloudflare-invalid-response",
          status: 200,
          retryable: false,
        };
      }
      return { ok: true, bookmark: response.result.at_bookmark };
    },

    async pollD1Export(accountId, databaseId, bookmark) {
      const response = await request(
        "POST",
        `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/export`,
        d1ExportSchema,
        { current_bookmark: bookmark },
      );
      if (!response.ok) return response;
      return response.result.signed_url === undefined
        ? { ok: true, state: "pending" }
        : { ok: true, state: "ready", downloadUrl: response.result.signed_url };
    },

    async getWorkersSubdomain(accountId) {
      const response = await request(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
        workersSubdomainSchema,
      );
      if (!response.ok) {
        return response.status === 404 ? { ok: true, registered: false } : response;
      }
      return { ok: true, registered: true, subdomain: response.result.subdomain };
    },

    async listWorkerDomains(accountId) {
      const response = await request(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/workers/domains`,
        z.array(workerDomainSchema),
      );
      if (!response.ok) return response;
      return {
        ok: true,
        domains: response.result.map((domain) => ({
          id: domain.id,
          hostname: domain.hostname,
          worker: domain.service,
        })),
      };
    },

    async attachWorkerDomain(accountId, hostname, workerName) {
      const response = await request(
        "PUT",
        `/accounts/${encodeURIComponent(accountId)}/workers/domains`,
        workerDomainSchema,
        { hostname, service: workerName },
      );
      if (!response.ok) return response;
      return {
        ok: true,
        domain: {
          id: response.result.id,
          hostname: response.result.hostname,
          worker: response.result.service,
        },
      };
    },

    async deleteWorkerDomain(accountId, domainId) {
      const response = await request(
        "DELETE",
        `/accounts/${encodeURIComponent(accountId)}/workers/domains/${encodeURIComponent(domainId)}`,
        z.null(),
      );
      return response.ok ? { ok: true } : response;
    },

    async listWorkerSecretNames(accountId, workerName) {
      const response = await request(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/secrets`,
        z.array(workerSecretSchema),
      );
      if (!response.ok) return response.status === 404 ? { ok: true, names: [] } : response;
      return { ok: true, names: response.result.map((secret) => secret.name) };
    },

    async listWorkerScripts(accountId) {
      const response = await request(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/workers/scripts`,
        z.array(workerScriptSchema),
      );
      if (!response.ok) return response;
      return { ok: true, scripts: response.result.map((script) => ({ name: script.id })) };
    },

    async listWorkerBindings(accountId, workerName) {
      const response = await request(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/bindings`,
        z.array(workerBindingSchema),
      );
      if (!response.ok) return response.status === 404 ? { ok: true, bindings: [] } : response;
      return {
        ok: true,
        bindings: response.result.map((binding) => ({
          name: binding.name,
          type: binding.type,
          ...(binding.database_id === undefined ? {} : { databaseId: binding.database_id }),
          ...(binding.queue_name === undefined ? {} : { queueName: binding.queue_name }),
        })),
      };
    },

    async listActiveWorkerVersions(accountId, workerName) {
      const response = await request(
        "GET",
        `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
        workerDeploymentsSchema,
      );
      if (!response.ok) return response.status === 404 ? { ok: true, versionIds: [] } : response;
      return {
        ok: true,
        versionIds:
          response.result.deployments[0]?.versions.map((version) => version.version_id) ?? [],
      };
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

    async deleteQueueConsumer(accountId, queueId, consumerId) {
      const response = await request(
        "DELETE",
        `/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/consumers/${encodeURIComponent(consumerId)}`,
        z.null(),
      );
      return response.ok ? { ok: true } : response;
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
    producers: (queue.producers ?? []).map((producer) => ({
      script: producer.script,
      type: producer.type,
    })),
    consumers: (queue.consumers ?? []).map((consumer) => ({
      id: consumer.consumer_id,
      scriptName: consumer.script_name,
      type: consumer.type,
      deadLetterQueue: consumer.dead_letter_queue,
      ...(consumer.settings?.max_retries === undefined
        ? {}
        : { maxRetries: consumer.settings.max_retries }),
      ...(consumer.settings?.max_batch_size === undefined &&
      consumer.settings?.batch_size === undefined
        ? {}
        : {
            maxBatchSize: consumer.settings.max_batch_size ?? consumer.settings.batch_size ?? 0,
          }),
      ...(consumer.settings?.max_batch_timeout === undefined &&
      consumer.settings?.max_wait_time_ms === undefined
        ? {}
        : {
            maxBatchTimeout:
              consumer.settings.max_batch_timeout ??
              (consumer.settings.max_wait_time_ms ?? 0) / 1_000,
          }),
      ...(consumer.settings?.max_concurrency === undefined
        ? {}
        : { maxConcurrency: consumer.settings.max_concurrency }),
      ...(consumer.settings?.retry_delay === undefined
        ? {}
        : { retryDelay: consumer.settings.retry_delay }),
    })),
  };
}

function routePatternCoversHostname(pattern: string, hostname: string): boolean {
  const hostPattern = pattern
    .replace(/^https?:\/\//u, "")
    .split("/")[0]
    ?.split(":")[0];
  if (hostPattern === undefined) return false;
  if (hostPattern === hostname) return true;
  return hostPattern.startsWith("*.") && hostname.endsWith(hostPattern.slice(1));
}

function failureForStatus(
  status: number,
  resource: string,
  method: "DELETE" | "GET" | "POST" | "PUT",
): CloudflareApiFailure {
  if (status === 401) {
    return { ok: false, kind: "cloudflare-authentication", status, retryable: false };
  }
  if (status === 403) {
    return {
      ok: false,
      kind: "cloudflare-authorization",
      status,
      retryable: false,
      resource,
      requiredPermission: requiredPermission(resource, method),
    };
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

function requiredPermission(resource: string, method: "DELETE" | "GET" | "POST" | "PUT") {
  const access = method === "GET" ? "Read" : "Edit";
  if (resource.includes("/dns_records")) return `Zone DNS ${access}`;
  if (resource.includes("/workers/routes")) return `Zone Workers Routes ${access}`;
  if (resource.includes("/pages/projects")) return `Account Pages ${access}`;
  if (resource.startsWith("/zones")) return "Account Zone Read";
  if (resource.includes("/d1/")) return `Account D1 ${access}`;
  if (resource.includes("/queues")) return `Account Queues ${access}`;
  return `Account Workers Scripts ${access}`;
}
