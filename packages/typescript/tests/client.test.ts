import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextToken, NextTokenError } from "../src";

const ENV_KEYS = [
  "NEXTTOKEN_API_KEY",
  "NEXTTOKEN_API_BASE_URL",
  "NEXTTOKEN_GATEWAY_BASE_URL",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("NextToken", () => {
  it("throws if no api key passed and env unset", () => {
    expect(() => new NextToken()).toThrow(NextTokenError);
  });

  it("falls back to NEXTTOKEN_API_KEY env var", () => {
    process.env["NEXTTOKEN_API_KEY"] = "envkey";
    const nt = new NextToken();
    expect(nt.apiKey).toBe("envkey");
  });

  it("uses default api.nexttoken.co base url", () => {
    const nt = new NextToken({ apiKey: "k" });
    expect(nt.baseUrl).toBe("https://api.nexttoken.co");
  });

  it("respects NEXTTOKEN_API_BASE_URL env var", () => {
    process.env["NEXTTOKEN_API_BASE_URL"] = "https://staging.example.com";
    const nt = new NextToken({ apiKey: "k" });
    expect(nt.baseUrl).toBe("https://staging.example.com");
  });

  it("constructor option overrides env var", () => {
    process.env["NEXTTOKEN_API_BASE_URL"] = "https://staging.example.com";
    const nt = new NextToken({
      apiKey: "k",
      baseUrl: "https://custom.example.com",
    });
    expect(nt.baseUrl).toBe("https://custom.example.com");
  });

  it("uses default gateway base url for chat/embeddings", () => {
    const nt = new NextToken({ apiKey: "k" });
    expect(nt.gatewayBaseUrl).toBe("https://gateway.nexttoken.co/v1");
  });

  it("respects NEXTTOKEN_GATEWAY_BASE_URL env var", () => {
    process.env["NEXTTOKEN_GATEWAY_BASE_URL"] = "https://gw-staging/v1";
    const nt = new NextToken({ apiKey: "k" });
    expect(nt.gatewayBaseUrl).toBe("https://gw-staging/v1");
  });

  it("lazy resource accessors return same instance across calls", () => {
    const nt = new NextToken({ apiKey: "k" });
    expect(nt.agents).toBe(nt.agents);
    expect(nt.workspaces).toBe(nt.workspaces);
    expect(nt.search).toBe(nt.search);
    expect(nt.fetch).toBe(nt.fetch);
    expect(nt.integrations).toBe(nt.integrations);
  });

  it("forwards fetchImpl to underlying HttpClient", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ workspaces: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const nt = new NextToken({ apiKey: "k", fetchImpl });
    await nt.workspaces.list();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.nexttoken.co/workspaces",
    );
  });
});
