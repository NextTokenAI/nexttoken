import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/http";
import { Search } from "../src/search";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Search.query", () => {
  it("posts to /search and unwraps data.results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          results: [
            { title: "T", url: "u", snippet: "s", published_date: "2026" },
          ],
        },
      }),
    );
    const search = new Search(new HttpClient({ apiKey: "k", fetchImpl }));
    const res = await search.query("hello");
    expect(res).toHaveLength(1);
    expect(res[0]?.title).toBe("T");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.nexttoken.co/search");
    expect((init as RequestInit).method).toBe("POST");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent).toEqual({ query: "hello", num_results: 10 });
  });

  it("translates camelCase options to snake_case wire format", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const search = new Search(new HttpClient({ apiKey: "k", fetchImpl }));
    await search.query("q", {
      numResults: 5,
      includeDomains: ["a.com"],
      excludeDomains: ["b.com"],
    });
    const sent = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sent).toEqual({
      query: "q",
      num_results: 5,
      include_domains: ["a.com"],
      exclude_domains: ["b.com"],
    });
  });

  it("returns empty array when server returns no data wrapper", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const search = new Search(new HttpClient({ apiKey: "k", fetchImpl }));
    expect(await search.query("q")).toEqual([]);
  });
});
