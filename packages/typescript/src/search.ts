import type { HttpClient } from "./http.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published_date?: string;
}

export interface SearchOptions {
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
}

interface SearchResponse {
  data?: { results?: SearchResult[] };
}

export class Search {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  async query(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
      query,
      num_results: opts.numResults ?? 10,
    };
    if (opts.includeDomains !== undefined) {
      body["include_domains"] = opts.includeDomains;
    }
    if (opts.excludeDomains !== undefined) {
      body["exclude_domains"] = opts.excludeDomains;
    }
    const res = await this.http.postJson<SearchResponse>("/search", body);
    return res?.data?.results ?? [];
  }
}
