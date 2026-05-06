import { HttpClient } from "./http.js";
import { NextTokenError } from "./errors.js";
import { Agents } from "./agents.js";
import { Workspaces } from "./workspaces.js";
import { Search } from "./search.js";
import { Fetch } from "./fetch.js";
import { Integrations } from "./integrations.js";

export interface NextTokenOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_GATEWAY_BASE_URL = "https://gateway.nexttoken.co/v1";

/**
 * Top-level NextToken client. All resource accessors are lazy: the
 * underlying class is constructed on first access.
 *
 * For OpenAI-compatible chat / embeddings / models, install the official
 * `openai` npm package and point it at `client.gatewayBaseUrl` with
 * `client.apiKey`:
 *
 * ```ts
 * import OpenAI from "openai";
 * import { NextToken } from "@nexttoken/sdk";
 *
 * const nt = new NextToken({ apiKey: process.env.NEXTTOKEN_API_KEY! });
 * const openai = new OpenAI({ apiKey: nt.apiKey, baseURL: nt.gatewayBaseUrl });
 * ```
 */
export class NextToken {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly gatewayBaseUrl: string;
  private readonly http: HttpClient;
  private _agents?: Agents;
  private _workspaces?: Workspaces;
  private _search?: Search;
  private _fetch?: Fetch;
  private _integrations?: Integrations;

  constructor(opts: NextTokenOptions = {}) {
    const apiKey = opts.apiKey ?? readEnv("NEXTTOKEN_API_KEY");
    if (!apiKey) {
      throw new NextTokenError(
        "Missing API key. Pass {apiKey} or set NEXTTOKEN_API_KEY.",
      );
    }
    const baseUrl =
      opts.baseUrl ?? readEnv("NEXTTOKEN_API_BASE_URL") ?? undefined;
    const gatewayBaseUrl =
      readEnv("NEXTTOKEN_GATEWAY_BASE_URL") ?? DEFAULT_GATEWAY_BASE_URL;

    const httpOpts: ConstructorParameters<typeof HttpClient>[0] = { apiKey };
    if (baseUrl !== undefined) httpOpts.baseUrl = baseUrl;
    if (opts.fetchImpl !== undefined) httpOpts.fetchImpl = opts.fetchImpl;
    this.http = new HttpClient(httpOpts);

    this.apiKey = apiKey;
    this.baseUrl = this.http.baseUrl;
    this.gatewayBaseUrl = gatewayBaseUrl;
  }

  get agents(): Agents {
    if (!this._agents) this._agents = new Agents(this.http);
    return this._agents;
  }

  get workspaces(): Workspaces {
    if (!this._workspaces) this._workspaces = new Workspaces(this.http);
    return this._workspaces;
  }

  get search(): Search {
    if (!this._search) this._search = new Search(this.http);
    return this._search;
  }

  get fetch(): Fetch {
    if (!this._fetch) this._fetch = new Fetch(this.http);
    return this._fetch;
  }

  get integrations(): Integrations {
    if (!this._integrations) this._integrations = new Integrations(this.http);
    return this._integrations;
  }
}

function readEnv(name: string): string | undefined {
  const env =
    typeof process !== "undefined" && process.env ? process.env : undefined;
  if (!env) return undefined;
  const v = env[name];
  return v && v.length > 0 ? v : undefined;
}
