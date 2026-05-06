import { errorFromResponse, NextTokenError } from "./errors.js";

export interface HttpClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const DEFAULT_BASE_URL = "https://api.nexttoken.co";

export class HttpClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpClientOptions) {
    if (!opts.apiKey) {
      throw new NextTokenError("apiKey is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private buildUrl(
    path: string,
    query?: RequestOptions["query"],
  ): string {
    // String-concat (not `new URL(path, base)`) so a baseUrl with a path
    // prefix is preserved. `new URL("/workspaces", "https://host/api/v1")`
    // would yield "https://host/workspaces" — dropping the prefix.
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${cleanPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      ...(extra ?? {}),
    };
  }

  private async parseErrorBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async raiseIfError(res: Response): Promise<void> {
    if (res.ok) return;
    const body = await this.parseErrorBody(res);
    const reqId = res.headers.get("x-request-id") ?? undefined;
    throw errorFromResponse(res.status, body, reqId);
  }

  async getJson<T>(path: string, opts?: RequestOptions): Promise<T> {
    const res = await this.fetchImpl(this.buildUrl(path, opts?.query), {
      method: "GET",
      headers: this.authHeaders(opts?.headers),
      signal: opts?.signal,
    });
    await this.raiseIfError(res);
    return readJsonOrEmpty<T>(res);
  }

  async postJson<T>(
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    const res = await this.fetchImpl(this.buildUrl(path, opts?.query), {
      method: "POST",
      headers: this.authHeaders({
        "Content-Type": "application/json",
        ...(opts?.headers ?? {}),
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts?.signal,
    });
    await this.raiseIfError(res);
    return readJsonOrEmpty<T>(res);
  }

  async putJson<T>(
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    const res = await this.fetchImpl(this.buildUrl(path, opts?.query), {
      method: "PUT",
      headers: this.authHeaders({
        "Content-Type": "application/json",
        ...(opts?.headers ?? {}),
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts?.signal,
    });
    await this.raiseIfError(res);
    return readJsonOrEmpty<T>(res);
  }

  async deleteEmpty(path: string, opts?: RequestOptions): Promise<void> {
    const res = await this.fetchImpl(this.buildUrl(path, opts?.query), {
      method: "DELETE",
      headers: this.authHeaders(opts?.headers),
      signal: opts?.signal,
    });
    await this.raiseIfError(res);
  }

  async postMultipart<T>(
    path: string,
    body: FormData,
    opts?: RequestOptions,
  ): Promise<T> {
    const res = await this.fetchImpl(this.buildUrl(path, opts?.query), {
      method: "POST",
      headers: this.authHeaders(opts?.headers),
      body,
      signal: opts?.signal,
    });
    await this.raiseIfError(res);
    return readJsonOrEmpty<T>(res);
  }

  async getStream(
    path: string,
    opts?: RequestOptions,
  ): Promise<{ body: ReadableStream<Uint8Array>; headers: Headers }> {
    const res = await this.fetchImpl(this.buildUrl(path, opts?.query), {
      method: "GET",
      headers: this.authHeaders(opts?.headers),
      signal: opts?.signal,
    });
    await this.raiseIfError(res);
    if (!res.body) {
      throw new NextTokenError("Response has no body");
    }
    return { body: res.body, headers: res.headers };
  }

  async openSSE(
    path: string,
    opts?: RequestOptions,
  ): Promise<{ body: ReadableStream<Uint8Array>; headers: Headers }> {
    const res = await this.fetchImpl(this.buildUrl(path, opts?.query), {
      method: "GET",
      headers: this.authHeaders({
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...(opts?.headers ?? {}),
      }),
      signal: opts?.signal,
    });
    await this.raiseIfError(res);
    if (!res.body) {
      throw new NextTokenError("SSE response has no body");
    }
    return { body: res.body, headers: res.headers };
  }
}

async function readJsonOrEmpty<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
