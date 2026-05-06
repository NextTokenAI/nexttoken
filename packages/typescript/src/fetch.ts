import type { HttpClient } from "./http.js";

export type FetchOutputFormat = "markdown" | "structure";

export interface FetchOptions {
  timeout?: number;
  maxContentLength?: number;
  outputFormat?: FetchOutputFormat;
}

export interface FetchResult {
  title: string;
  content: string;
  url: string;
  links: unknown[];
  method: string;
  content_length: number;
  truncated?: boolean;
  total_length?: number;
}

interface FetchResponse {
  data?: FetchResult;
}

export class Fetch {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  async url(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const body = {
      url,
      timeout: opts.timeout ?? 10,
      max_content_length: opts.maxContentLength ?? 1_000_000,
      output_format: opts.outputFormat ?? "markdown",
    };
    const res = await this.http.postJson<FetchResponse>("/fetch", body);
    return res?.data ?? ({} as FetchResult);
  }
}
