import { z } from "zod";

export type ApiErrorBody = Readonly<{
  ok: false;
  kind: string;
  details: Readonly<Record<string, unknown>>;
}>;

const apiErrorBodySchema = z
  .strictObject({
    ok: z.literal(false),
    kind: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .transform((body): ApiErrorBody => ({ ...body, details: body.details ?? {} }));

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.kind);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export class ApiProtocolError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiProtocolError";
    this.status = status;
  }
}

export type ApiOptions = Readonly<{
  method?: "GET" | "POST" | "PATCH";
  body?: object;
  csrfToken?: string;
}>;

export async function jsonRequest<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  options: ApiOptions = {},
): Promise<z.output<Schema>> {
  const response = await fetch(path, createRequest(options));
  if (response.status === 204) {
    throw new ApiProtocolError(response.status, "Expected a JSON response but received no content");
  }

  const body = await readJson(response);
  if (!response.ok) {
    throwApiError(response.status, body);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiProtocolError(response.status, "The server returned an invalid response");
  }
  return parsed.data;
}

export async function noContentRequest(path: string, options: ApiOptions = {}): Promise<void> {
  const response = await fetch(path, createRequest(options));
  if (response.status === 204) return;

  const body = await readJson(response);
  if (!response.ok) {
    throwApiError(response.status, body);
  }
  throw new ApiProtocolError(response.status, "Expected a no-content response");
}

function createRequest(options: ApiOptions): RequestInit {
  const request: RequestInit = {
    credentials: "same-origin",
    method: options.method ?? "GET",
  };
  if (options.body !== undefined) {
    request.body = JSON.stringify(options.body);
  }
  if (options.body !== undefined || options.csrfToken !== undefined) {
    request.headers = {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.csrfToken === undefined ? {} : { "x-csrf-token": options.csrfToken }),
    };
  }
  return request;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiProtocolError(response.status, "The server returned malformed JSON");
  }
}

function throwApiError(status: number, body: unknown): never {
  const parsed = apiErrorBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiProtocolError(status, "The server returned an invalid error response");
  }
  throw new ApiError(status, parsed.data);
}
