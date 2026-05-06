import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/http";
import {
  AuthError,
  BadRequestError,
  ConflictError,
  InsufficientCreditsError,
  NextTokenError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  RunCapExceededError,
  ServerError,
} from "../src/errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe("HttpClient construction", () => {
  it("requires an apiKey", () => {
    expect(() => new HttpClient({ apiKey: "" })).toThrow(NextTokenError);
  });

  it("strips trailing slashes from baseUrl", () => {
    const client = new HttpClient({
      apiKey: "k",
      baseUrl: "https://api.nexttoken.co///",
    });
    expect(client.baseUrl).toBe("https://api.nexttoken.co");
  });

  it("defaults baseUrl to api.nexttoken.co", () => {
    const client = new HttpClient({ apiKey: "k" });
    expect(client.baseUrl).toBe("https://api.nexttoken.co");
  });
});

describe("HttpClient.getJson", () => {
  it("sends Bearer auth and parses JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { hello: "world" }),
    );
    const client = new HttpClient({ apiKey: "secret", fetchImpl });
    const result = await client.getJson<{ hello: string }>("/ping");
    expect(result).toEqual({ hello: "world" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.nexttoken.co/ping");
    expect((init as RequestInit).method).toBe("GET");
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("preserves baseUrl path prefix", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new HttpClient({
      apiKey: "k",
      baseUrl: "https://api.example.com/api/v1",
      fetchImpl,
    });
    await client.getJson("/workspaces");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.example.com/api/v1/workspaces",
    );
  });

  it("preserves baseUrl path prefix when adding query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new HttpClient({
      apiKey: "k",
      baseUrl: "https://api.example.com/api/v1",
      fetchImpl,
    });
    await client.getJson("/workspaces/ws_1/files", {
      query: { path: "inputs", recursive: "true" },
    });
    const u = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(u.pathname).toBe("/api/v1/workspaces/ws_1/files");
    expect(u.searchParams.get("path")).toBe("inputs");
    expect(u.searchParams.get("recursive")).toBe("true");
  });

  it("encodes query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await client.getJson("/search", {
      query: { q: "hello world", n: 10, b: true, skip: undefined },
    });
    const [url] = fetchImpl.mock.calls[0];
    const u = new URL(url as string);
    expect(u.searchParams.get("q")).toBe("hello world");
    expect(u.searchParams.get("n")).toBe("10");
    expect(u.searchParams.get("b")).toBe("true");
    expect(u.searchParams.has("skip")).toBe(false);
  });
});

describe("HttpClient error mapping", () => {
  it("maps 401 to AuthError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(401, { detail: "Invalid API key" }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.getJson("/ping")).rejects.toBeInstanceOf(AuthError);
  });

  it("maps 404 to NotFoundError carrying detail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(404, { detail: "Run not found" }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.getJson("/agents/runs/x")).rejects.toMatchObject({
      status: 404,
      detail: "Run not found",
      name: "NotFoundError",
    });
  });

  it("maps 402 to InsufficientCreditsError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(402, { detail: "Insufficient credits" }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.postJson("/search", {})).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
  });

  it("maps 409 to ConflictError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, { detail: "Active task" }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.deleteEmpty("/workspaces/abc")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("maps 413 to PayloadTooLargeError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(413, { detail: "File too large" }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.getJson("/x")).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });

  it("maps 400 to BadRequestError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, { detail: "Bad" }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.getJson("/x")).rejects.toBeInstanceOf(BadRequestError);
  });

  it("maps 429 without cap payload to RateLimitError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(429, { detail: "Slow down" }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.getJson("/x")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("maps 429 with cap payload to RunCapExceededError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(429, {
        detail: {
          error: "active_run_cap_exceeded",
          message: "User cap exceeded",
          tier: "pro",
          cap: 3,
          scope: "user",
        },
      }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    const err = (await client
      .postJson("/agents/runs", {})
      .catch((e) => e)) as RunCapExceededError;
    expect(err).toBeInstanceOf(RunCapExceededError);
    expect(err.tier).toBe("pro");
    expect(err.cap).toBe(3);
    expect(err.scope).toBe("user");
  });

  it("maps 5xx to ServerError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(503, { detail: "Down" }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.getJson("/x")).rejects.toBeInstanceOf(ServerError);
  });

  it("handles non-JSON error body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("plain text fail", { status: 500 }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.getJson("/x")).rejects.toMatchObject({
      status: 500,
      detail: "plain text fail",
    });
  });

  it("captures x-request-id from error response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "boom" }), {
        status: 500,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_abc",
        },
      }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    const err = (await client.getJson("/x").catch((e) => e)) as {
      requestId: string;
    };
    expect(err.requestId).toBe("req_abc");
  });
});

describe("HttpClient empty responses", () => {
  it("deleteEmpty returns void on 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(204));
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.deleteEmpty("/x")).resolves.toBeUndefined();
  });

  it("getJson tolerates empty body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await expect(client.getJson("/x")).resolves.toBeUndefined();
  });
});

describe("HttpClient streaming", () => {
  it("getStream returns body + headers", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { "x-foo": "bar" } }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    const { body, headers } = await client.getStream("/x");
    expect(headers.get("x-foo")).toBe("bar");
    const reader = body.getReader();
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    expect(value).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("openSSE sends Accept: text/event-stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200 }),
    );
    const client = new HttpClient({ apiKey: "k", fetchImpl });
    await client.openSSE("/agents/runs/abc/events");
    const [, init] = fetchImpl.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Accept).toBe("text/event-stream");
  });
});
