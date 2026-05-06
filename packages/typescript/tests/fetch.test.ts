import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/http";
import { Fetch } from "../src/fetch";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Fetch.url", () => {
  it("posts to /fetch with default options", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          title: "T",
          content: "c",
          url: "u",
          links: [],
          method: "readability",
          content_length: 1,
        },
      }),
    );
    const f = new Fetch(new HttpClient({ apiKey: "k", fetchImpl }));
    const res = await f.url("https://example.com");
    expect(res.title).toBe("T");
    const sent = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sent).toEqual({
      url: "https://example.com",
      timeout: 10,
      max_content_length: 1_000_000,
      output_format: "markdown",
    });
  });

  it("translates camelCase options to snake_case wire format", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: {} }));
    const f = new Fetch(new HttpClient({ apiKey: "k", fetchImpl }));
    await f.url("https://example.com", {
      timeout: 25,
      maxContentLength: 5000,
      outputFormat: "structure",
    });
    const sent = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sent).toEqual({
      url: "https://example.com",
      timeout: 25,
      max_content_length: 5000,
      output_format: "structure",
    });
  });
});
