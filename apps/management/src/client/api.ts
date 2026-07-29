export type ApiErrorBody = Readonly<{
  ok: false;
  kind: string;
  details: Readonly<Record<string, unknown>>;
}>;

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

type ApiOptions = Readonly<{
  method?: "GET" | "POST" | "PATCH";
  body?: object;
  csrfToken?: string;
}>;

export async function apiRequest<ResponseBody>(
  path: string,
  options: ApiOptions = {},
): Promise<ResponseBody> {
  const request: RequestInit = {
    credentials: "same-origin",
    method: options.method ?? "GET",
  };
  if (options.body !== undefined) {
    request.headers = {
      "content-type": "application/json",
      ...(options.csrfToken ? { "x-csrf-token": options.csrfToken } : {}),
    };
    request.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, request);
  if (response.status === 204) return undefined as ResponseBody;
  const body = (await response.json()) as ResponseBody | ApiErrorBody;
  if (!response.ok || !("ok" in (body as object)) || (body as { ok: boolean }).ok === false) {
    throw new ApiError(response.status, body as ApiErrorBody);
  }
  return body as ResponseBody;
}
