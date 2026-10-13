export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, unknown> = {},
    public requestId?: string,
  ) {
    super(message);
  }
}
async function request(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("testflow:session-expired"));
    throw new ApiError(
      response.status,
      error.code || "request_error",
      error.message || `HTTP ${response.status}`,
      error.fields,
      error.request_id,
    );
  }
  return response;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return (await request(path, options)).json() as Promise<T>;
}
export async function exportFile(
  path: string,
  body: unknown,
  filename: string,
) {
  const response = await request(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const getJson = <T>(path: string, signal?: AbortSignal) =>
  api<T>(path, { signal });
export function write<T>(
  path: string,
  body?: unknown,
  method = "POST",
  key?: string,
) {
  return api<T>(path, {
    method,
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    headers: key ? { "Idempotency-Key": key } : undefined,
  });
}
export const operationKey = () => crypto.randomUUID();
