import type { HttpClient } from "./http.js";
import { NextTokenError, TimeoutError } from "./errors.js";
import { parseSSEStream } from "./sse.js";
import type { Workspace } from "./workspaces.js";

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "completed",
  "failed",
  "timeout",
  "cancelled",
]);

const LONG_POLL_MAX_WAIT_SECONDS = 30;

export interface RunMessage {
  id: string;
  role: string;
  content: string;
  sequence: number;
  toolCallCount: number;
  toolResultCount: number;
}

export interface RunResult {
  runId: string;
  workspaceId: string;
  conversationId: string;
  status: RunStatus;
  finalText: string | null;
  messages: RunMessage[];
  usageEstimate: Record<string, unknown> | null;
  durationMs: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunEvent {
  type: "message" | "terminal";
  id: string | null;
  data: Record<string, unknown>;
}

interface RunMessageWire {
  id: string;
  role: string;
  content: string;
  sequence: number;
  tool_call_count?: number;
  tool_result_count?: number;
}

interface RunStatusResponseWire {
  run_id: string;
  workspace_id: string;
  conversation_id: string;
  status: RunStatus;
  final_text?: string | null;
  messages?: RunMessageWire[] | null;
  usage_estimate?: Record<string, unknown> | null;
  duration_ms?: number | null;
  error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageFromWire(m: RunMessageWire): RunMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    sequence: m.sequence,
    toolCallCount: m.tool_call_count ?? 0,
    toolResultCount: m.tool_result_count ?? 0,
  };
}

function runResultFromWire(d: RunStatusResponseWire): RunResult {
  return {
    runId: d.run_id,
    workspaceId: d.workspace_id,
    conversationId: d.conversation_id,
    status: d.status,
    finalText: d.final_text ?? null,
    messages: (d.messages ?? []).map(messageFromWire),
    usageEstimate: d.usage_estimate ?? null,
    durationMs: d.duration_ms ?? null,
    error: d.error ?? null,
    startedAt: d.started_at ?? null,
    completedAt: d.completed_at ?? null,
  };
}

export interface AgentCreateOptions {
  workspace: Workspace | string;
  model?: string;
  conversationId?: string;
}

export interface AgentSendOptions {
  timeoutSeconds?: number;
}

export interface RunWaitOptions {
  timeoutMs?: number;
}

export interface AgentsRunOptions {
  workspaceId: string;
  conversationId?: string;
  model?: string;
  timeoutSeconds?: number;
  waitTimeoutMs?: number;
}

export class Run {
  readonly runId: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  private readonly agents: Agents;
  private cachedStatus: RunStatus | null = null;

  constructor(
    runId: string,
    workspaceId: string,
    conversationId: string,
    agents: Agents,
    initialStatus?: RunStatus,
  ) {
    this.runId = runId;
    this.workspaceId = workspaceId;
    this.conversationId = conversationId;
    this.agents = agents;
    if (initialStatus !== undefined) this.cachedStatus = initialStatus;
  }

  get lastKnownStatus(): RunStatus | null {
    return this.cachedStatus;
  }

  done(): boolean {
    return (
      this.cachedStatus !== null &&
      TERMINAL_STATUSES.has(this.cachedStatus)
    );
  }

  async refresh(): Promise<this> {
    const data = await this.agents._fetchRun(this.runId);
    this.cachedStatus = data.status;
    return this;
  }

  async cancel(): Promise<this> {
    const data = await this.agents._cancelRun(this.runId);
    this.cachedStatus = data.status;
    return this;
  }

  /**
   * Stream live events from this run. Yields `RunEvent`s — first the
   * replayed message history, then live messages, then a single
   * `terminal` event when the run reaches a terminal state. Auto-reconnects
   * on transient disconnects via `Last-Event-ID` (max 3 attempts,
   * exponential backoff capped at 5s). If the run is already terminal at
   * budget exhaustion, emits a synthetic terminal event from the current
   * row; otherwise throws so callers can't silently exit a `for await`
   * loop with the run still pending.
   */
  async *stream(): AsyncGenerator<RunEvent, void, void> {
    let lastId: string | null = null;
    let attempts = 0;
    const maxReconnects = 3;

    while (true) {
      try {
        const headers: Record<string, string> = {};
        if (lastId !== null) headers["Last-Event-ID"] = lastId;

        const events = this.agents._streamEvents(this.runId, headers);
        let sawTerminal = false;
        for await (const ev of events) {
          if (ev.id !== null) lastId = ev.id;
          yield ev;
          if (ev.type === "terminal") {
            const status = ev.data["status"];
            if (typeof status === "string") {
              this.cachedStatus = status as RunStatus;
            }
            sawTerminal = true;
            return;
          }
        }
        if (sawTerminal) return;
        // Server closed without a terminal event — soft disconnect.
        attempts += 1;
        if (attempts > maxReconnects) {
          yield await this.synthesizeTerminalOrThrow(
            "stream closed without terminal event after retry budget",
          );
          return;
        }
        await sleep(Math.min(2000 * attempts, 5000));
      } catch (err) {
        attempts += 1;
        if (attempts > maxReconnects) throw err;
        await sleep(Math.min(2000 * attempts, 5000));
      }
    }
  }

  private async synthesizeTerminalOrThrow(
    softReason: string,
  ): Promise<RunEvent> {
    // Last chance: refresh once. If the row has gone terminal, emit a
    // synthetic terminal event so the for-await loop closes correctly.
    // Otherwise throw so the caller can't mistake "stream gave up" for
    // "run finished".
    const data = await this.agents._fetchRun(this.runId);
    this.cachedStatus = data.status;
    if (TERMINAL_STATUSES.has(data.status)) {
      return {
        type: "terminal",
        id: null,
        data: {
          run_id: data.run_id,
          status: data.status,
          started_at: data.started_at ?? null,
          completed_at: data.completed_at ?? null,
          duration_ms: data.duration_ms ?? null,
          final_text: data.final_text ?? null,
          error: data.error ?? null,
        },
      };
    }
    throw new NextTokenError(
      `Run ${this.runId} ${softReason} (last status: ${data.status})`,
    );
  }

  async wait(opts: RunWaitOptions = {}): Promise<RunResult> {
    const deadline =
      opts.timeoutMs === undefined
        ? null
        : Date.now() + Math.max(0, opts.timeoutMs);

    while (true) {
      const now = Date.now();
      if (deadline !== null && now >= deadline) {
        throw new TimeoutError(
          `Run ${this.runId} did not complete within ${opts.timeoutMs}ms`,
        );
      }

      const thisWait =
        deadline === null
          ? LONG_POLL_MAX_WAIT_SECONDS
          : Math.min(
              LONG_POLL_MAX_WAIT_SECONDS,
              Math.max(1, Math.ceil((deadline - now) / 1000)),
            );

      const data = await this.agents._fetchRun(this.runId, {
        waitForTerminal: true,
        maxWait: thisWait,
      });
      this.cachedStatus = data.status;
      if (TERMINAL_STATUSES.has(data.status)) {
        return runResultFromWire(data);
      }
    }
  }
}

export class Agent {
  readonly workspaceId: string;
  readonly model: string | null;
  conversationId: string | null;
  private readonly agents: Agents;

  constructor(
    workspaceId: string,
    agents: Agents,
    opts: { model?: string; conversationId?: string } = {},
  ) {
    this.workspaceId = workspaceId;
    this.model = opts.model ?? null;
    this.conversationId = opts.conversationId ?? null;
    this.agents = agents;
  }

  async send(prompt: string, opts: AgentSendOptions = {}): Promise<Run> {
    const run = await this.agents._createRun({
      prompt,
      workspaceId: this.workspaceId,
      conversationId: this.conversationId,
      model: this.model,
      timeoutSeconds: opts.timeoutSeconds ?? 600,
    });
    if (this.conversationId === null) {
      this.conversationId = run.conversationId;
    }
    return run;
  }

  reset(): void {
    this.conversationId = null;
  }
}

export class Agents {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  create(opts: AgentCreateOptions): Agent {
    const wsId =
      typeof opts.workspace === "string" ? opts.workspace : opts.workspace.id;
    const agentOpts: { model?: string; conversationId?: string } = {};
    if (opts.model !== undefined) agentOpts.model = opts.model;
    if (opts.conversationId !== undefined) {
      agentOpts.conversationId = opts.conversationId;
    }
    return new Agent(wsId, this, agentOpts);
  }

  async run(prompt: string, opts: AgentsRunOptions): Promise<RunResult> {
    const run = await this._createRun({
      prompt,
      workspaceId: opts.workspaceId,
      conversationId: opts.conversationId ?? null,
      model: opts.model ?? null,
      timeoutSeconds: opts.timeoutSeconds ?? 600,
    });
    const waitOpts: RunWaitOptions = {};
    if (opts.waitTimeoutMs !== undefined) waitOpts.timeoutMs = opts.waitTimeoutMs;
    return run.wait(waitOpts);
  }

  async getRun(runId: string): Promise<Run> {
    const data = await this._fetchRun(runId);
    return new Run(
      data.run_id,
      data.workspace_id,
      data.conversation_id,
      this,
      data.status,
    );
  }

  async _createRun(args: {
    prompt: string;
    workspaceId: string;
    conversationId: string | null;
    model: string | null;
    timeoutSeconds: number;
  }): Promise<Run> {
    const body: Record<string, unknown> = {
      prompt: args.prompt,
      workspace_id: args.workspaceId,
      timeout_seconds: args.timeoutSeconds,
    };
    if (args.conversationId !== null) body["conversation_id"] = args.conversationId;
    if (args.model !== null) body["model"] = args.model;
    const data = await this.http.postJson<RunStatusResponseWire>(
      "/agents/runs",
      body,
    );
    return new Run(
      data.run_id,
      data.workspace_id,
      data.conversation_id,
      this,
      data.status,
    );
  }

  async _cancelRun(runId: string): Promise<RunStatusResponseWire> {
    return this.http.postJson<RunStatusResponseWire>(
      `/agents/runs/${encodeURIComponent(runId)}/cancel`,
    );
  }

  async *_streamEvents(
    runId: string,
    headers: Record<string, string>,
  ): AsyncGenerator<RunEvent, void, void> {
    const { body } = await this.http.openSSE(
      `/agents/runs/${encodeURIComponent(runId)}/events`,
      { headers },
    );
    for await (const parsed of parseSSEStream(body)) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(parsed.data) as Record<string, unknown>;
      } catch {
        data = { raw: parsed.data };
      }
      const type =
        parsed.event === "terminal" ? "terminal" : "message";
      yield { type, id: parsed.id, data };
    }
  }

  async _fetchRun(
    runId: string,
    opts: { waitForTerminal?: boolean; maxWait?: number } = {},
  ): Promise<RunStatusResponseWire> {
    const query: Record<string, string | number> = {};
    if (opts.waitForTerminal) {
      query["wait_for_terminal"] = "true";
      if (opts.maxWait !== undefined && opts.maxWait > 0) {
        query["max_wait"] = opts.maxWait;
      }
    }
    return this.http.getJson<RunStatusResponseWire>(
      `/agents/runs/${encodeURIComponent(runId)}`,
      { query },
    );
  }
}
