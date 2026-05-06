import type { HttpClient } from "./http.js";

export type IntegrationApp = Record<string, unknown>;
export type IntegrationAction = Record<string, unknown>;
export type IntegrationActionDetails = Record<string, unknown>;
export type IntegrationInvokeResult = Record<string, unknown>;

interface ListResponse {
  data?: { integrations?: IntegrationApp[] };
}
interface SearchResponse {
  data?: { apps?: IntegrationApp[] };
}
interface ActionsResponse {
  data?: { actions?: IntegrationAction[] };
}
interface ActionDetailsResponse {
  data?: IntegrationActionDetails;
}
interface InvokeResponse {
  data?: IntegrationInvokeResult;
}

export class Integrations {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  async list(): Promise<IntegrationApp[]> {
    const res = await this.http.getJson<ListResponse>("/integrations");
    return res?.data?.integrations ?? [];
  }

  async search(query: string): Promise<IntegrationApp[]> {
    const res = await this.http.getJson<SearchResponse>(
      "/integrations/search",
      { query: { q: query } },
    );
    return res?.data?.apps ?? [];
  }

  async listActions(app: string): Promise<IntegrationAction[]> {
    const res = await this.http.getJson<ActionsResponse>(
      `/integrations/${encodeURIComponent(app)}/actions`,
    );
    return res?.data?.actions ?? [];
  }

  async getActionDetails(
    app: string,
    actionKey: string,
  ): Promise<IntegrationActionDetails> {
    const res = await this.http.getJson<ActionDetailsResponse>(
      `/integrations/${encodeURIComponent(app)}/actions/${encodeURIComponent(actionKey)}`,
    );
    return res?.data ?? {};
  }

  async invoke(
    app: string,
    functionKey: string,
    args: Record<string, unknown> = {},
  ): Promise<IntegrationInvokeResult> {
    const res = await this.http.postJson<InvokeResponse>(
      `/integrations/${encodeURIComponent(app)}/invoke`,
      { action_key: functionKey, props: args },
    );
    return res?.data ?? {};
  }
}
