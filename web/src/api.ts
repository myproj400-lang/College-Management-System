export class ApiError extends Error {
  status: number;
  details?: Record<string, string[]>;

  constructor(status: number, message: string, details?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = err.details
      ? Object.entries(err.details)
          .flatMap(([key, messages]) => messages.map((message) => `${key}: ${message}`))
          .join(' ')
      : '';
    return fields ? `${err.message} ${fields}` : err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function api(token?: string | null) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`/api${path}`, { ...init, headers });
    if (response.status === 204) return undefined as T;
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      details?: Record<string, string[]>;
    };
    if (!response.ok) throw new ApiError(response.status, body.error ?? 'Request failed', body.details);
    return body as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, payload?: unknown, headers?: HeadersInit) =>
      request<T>(path, { method: 'POST', body: payload === undefined ? undefined : JSON.stringify(payload), headers }),
    patch: <T>(path: string, payload: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) }),
    put: <T>(path: string, payload: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(payload) }),
  };
}
