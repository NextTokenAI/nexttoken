import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/http";
import { Agents } from "../src/agents";
import { NotFoundError, TimeoutError } from "../src/errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "run_1",
    workspace_id: "ws_1",
    conversation_id: "conv_1",
    status: "running",
    final_text: null,
    messages: null,
    usage_estimate: null,
    duration_ms: null,
    error: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

describe("Agents.create", () => {
  it("accepts a workspace id string", () => {
    const agents = new Agents(new HttpClient({ apiKey: "k" }));
    const a = agents.create({ workspace: "ws_1" });
    expect(a.workspaceId).toBe("ws_1");
    expect(a.conversationId).toBeNull();
  });

  it("accepts a Workspace handle", () => {
    const agents = new Agents(new HttpClient({ apiKey: "k" }));
    const fakeWorkspace = { id: "ws_42" } as unknown as import("../src/workspaces").Workspace;
    const a = agents.create({ workspace: fakeWorkspace, model: "gpt-5" });
    expect(a.workspaceId).toBe("ws_42");
    expect(a.model).toBe("gpt-5");
  });
});

describe("Agent.send", () => {
  it("POSTs to /agents/runs with bundled defaults and populates conversationId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(202, runRow({ status: "running" })),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const a = agents.create({ workspace: "ws_1", model: "gpt-5" });
    expect(a.conversationId).toBeNull();
    const run = await a.send("hi");
    expect(run.runId).toBe("run_1");
    expect(a.conversationId).toBe("conv_1");

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: "hi",
      workspace_id: "ws_1",
      timeout_seconds: 600,
      model: "gpt-5",
    });
  });

  it("reuses conversationId on subsequent sends", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(202, runRow({ run_id: "run_2" })),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const a = agents.create({ workspace: "ws_1" });
    await a.send("first");
    await a.send("second");
    const sentSecond = JSON.parse(
      (fetchImpl.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(sentSecond.conversation_id).toBe("conv_1");
  });

  it("reset() clears conversationId for next send", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(202, runRow())));
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const a = agents.create({ workspace: "ws_1" });
    await a.send("first");
    expect(a.conversationId).toBe("conv_1");
    a.reset();
    expect(a.conversationId).toBeNull();
    await a.send("second");
    const sent = JSON.parse(
      (fetchImpl.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(sent.conversation_id).toBeUndefined();
  });

  it("respects custom timeoutSeconds", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(202, runRow())));
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const a = agents.create({ workspace: "ws_1" });
    await a.send("hi", { timeoutSeconds: 1200 });
    const sent = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sent.timeout_seconds).toBe(1200);
  });
});

describe("Run.wait", () => {
  it("returns RunResult when already terminal on first poll", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow({ status: "running" })));
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(
        200,
        runRow({
          status: "completed",
          final_text: "done",
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "done",
              sequence: 1,
              tool_call_count: 0,
              tool_result_count: 0,
            },
          ],
        }),
      ),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const a = agents.create({ workspace: "ws_1" });
    const run = await a.send("go");
    const result = await run.wait();
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("done");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.toolCallCount).toBe(0);

    const url2 = new URL(fetchImpl.mock.calls[1][0] as string);
    expect(url2.searchParams.get("wait_for_terminal")).toBe("true");
    expect(url2.searchParams.get("max_wait")).toBe("30");
  });

  it("loops while non-terminal and returns once terminal", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, runRow({ status: "running" })));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, runRow({ status: "running" })));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, runRow({ status: "completed" })));
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await (agents.create({ workspace: "ws_1" })).send("go");
    const result = await run.wait();
    expect(result.status).toBe("completed");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("throws TimeoutError when wall-clock exceeded", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    fetchImpl.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, runRow({ status: "running" }))),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await (agents.create({ workspace: "ws_1" })).send("go");
    await expect(run.wait({ timeoutMs: 0 })).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it("caps max_wait at min(30, remaining)", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, runRow({ status: "completed" })));
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await (agents.create({ workspace: "ws_1" })).send("go");
    await run.wait({ timeoutMs: 5_000 });
    const url = new URL(fetchImpl.mock.calls[1][0] as string);
    const maxWait = Number(url.searchParams.get("max_wait"));
    expect(maxWait).toBeLessThanOrEqual(5);
    expect(maxWait).toBeGreaterThanOrEqual(1);
  });
});

describe("Run.refresh and lastKnownStatus", () => {
  it("refresh() short-polls without wait params and updates cache", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, runRow({ status: "completed" })));
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await (agents.create({ workspace: "ws_1" })).send("go");
    expect(run.lastKnownStatus).toBe("running");
    await run.refresh();
    expect(run.lastKnownStatus).toBe("completed");

    const url = new URL(fetchImpl.mock.calls[1][0] as string);
    expect(url.searchParams.has("wait_for_terminal")).toBe(false);
  });

  it("done() reflects each terminal status", async () => {
    const fetchImpl = vi.fn();
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    for (const status of ["completed", "failed", "timeout", "cancelled"] as const) {
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(202, runRow({ status: "running" })),
      );
      fetchImpl.mockResolvedValueOnce(jsonResponse(200, runRow({ status })));
      const run = await (agents.create({ workspace: "ws_1" })).send("go");
      expect(run.done()).toBe(false);
      await run.refresh();
      expect(run.done()).toBe(true);
    }
  });
});

describe("Run.cancel", () => {
  it("POSTs to cancel endpoint and updates status cache", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, runRow({ status: "running" })),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await (agents.create({ workspace: "ws_1" })).send("go");
    const same = await run.cancel();
    expect(same).toBe(run);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      "https://api.nexttoken.co/agents/runs/run_1/cancel",
    );
  });

  it("idempotent on already-terminal run (200 with terminal status)", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow({ status: "completed" })));
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, runRow({ status: "completed" })),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await (agents.create({ workspace: "ws_1" })).send("go");
    await run.cancel();
    expect(run.lastKnownStatus).toBe("completed");
  });
});

describe("Agents.getRun", () => {
  it("populates ids from server response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, runRow({ status: "running" })),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await agents.getRun("run_1");
    expect(run.runId).toBe("run_1");
    expect(run.workspaceId).toBe("ws_1");
    expect(run.conversationId).toBe("conv_1");
    expect(run.lastKnownStatus).toBe("running");
  });

  it("throws NotFoundError on 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(404, { detail: "Run not found" }),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    await expect(agents.getRun("missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Agents.run (one-shot)", () => {
  it("creates then waits", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, runRow({ status: "completed", final_text: "ok" })),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const result = await agents.run("hi", { workspaceId: "ws_1" });
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("ok");
  });
});
