import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/http";
import { Agents, type RunEvent } from "../src/agents";
import { NextTokenError } from "../src/errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseStream(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(s));
      controller.close();
    },
  });
}

function sseResponse(s: string): Response {
  return new Response(sseStream(s), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "run_1",
    workspace_id: "ws_1",
    conversation_id: "conv_1",
    status: "running",
    ...overrides,
  };
}

async function consume(
  it: AsyncGenerator<RunEvent, void, void>,
): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe("Run.stream", () => {
  it("yields message events then terminal and closes", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    fetchImpl.mockResolvedValueOnce(
      sseResponse(
        [
          'event: message\nid: 1\ndata: {"id":"m1","role":"assistant","content":"hi","sequence":1,"tool_call_count":0,"tool_result_count":0}\n\n',
          'event: message\nid: 2\ndata: {"id":"m2","role":"assistant","content":"there","sequence":2,"tool_call_count":0,"tool_result_count":0}\n\n',
          'event: terminal\ndata: {"run_id":"run_1","status":"completed","final_text":"there","error":null,"started_at":null,"completed_at":null,"duration_ms":12}\n\n',
        ].join(""),
      ),
    );
    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await agents.create({ workspace: "ws_1" }).send("go");
    const events = await consume(run.stream());

    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe("message");
    expect(events[0]?.id).toBe("1");
    expect(events[2]?.type).toBe("terminal");
    expect(events[2]?.data["status"]).toBe("completed");
    expect(run.lastKnownStatus).toBe("completed");
  });

  it("sends Last-Event-ID on reconnect after non-terminal close", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    // First SSE attempt: emits id 5 then closes WITHOUT terminal.
    fetchImpl.mockResolvedValueOnce(
      sseResponse(
        'event: message\nid: 5\ndata: {"id":"m5","role":"assistant","content":"a","sequence":5,"tool_call_count":0,"tool_result_count":0}\n\n',
      ),
    );
    // Second SSE attempt: emits terminal.
    fetchImpl.mockResolvedValueOnce(
      sseResponse(
        'event: terminal\ndata: {"run_id":"run_1","status":"completed"}\n\n',
      ),
    );

    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await agents.create({ workspace: "ws_1" }).send("go");

    // Use fake timers so reconnect backoff doesn't actually wait.
    vi.useFakeTimers();
    const promise = consume(run.stream());
    await vi.runAllTimersAsync();
    const events = await promise;
    vi.useRealTimers();

    expect(events).toHaveLength(2);
    expect(events[0]?.id).toBe("5");
    expect(events[1]?.type).toBe("terminal");

    // 3 fetch calls total: send + 2 SSE
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const secondSSEHeaders = (fetchImpl.mock.calls[2][1] as RequestInit)
      .headers as Record<string, string>;
    expect(secondSSEHeaders["Last-Event-ID"]).toBe("5");
    expect(secondSSEHeaders.Accept).toBe("text/event-stream");
  });

  it("emits synthetic terminal when soft-disconnect budget exhausted but row is terminal", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    // 4 SSE attempts (1 initial + 3 retries), each closes without terminal.
    for (let i = 0; i < 4; i++) {
      fetchImpl.mockResolvedValueOnce(sseResponse(""));
    }
    // Final refresh after budget — row went terminal in the meantime.
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(
        200,
        runRow({
          status: "completed",
          final_text: "result",
          duration_ms: 999,
          completed_at: "2026-05-06T00:00:00Z",
        }),
      ),
    );

    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await agents.create({ workspace: "ws_1" }).send("go");

    vi.useFakeTimers();
    const promise = consume(run.stream());
    await vi.runAllTimersAsync();
    const events = await promise;
    vi.useRealTimers();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("terminal");
    expect(events[0]?.data["status"]).toBe("completed");
    expect(events[0]?.data["final_text"]).toBe("result");
    expect(run.lastKnownStatus).toBe("completed");
  });

  it("throws when soft-disconnect budget exhausted and row is still running", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    for (let i = 0; i < 4; i++) {
      fetchImpl.mockResolvedValueOnce(sseResponse(""));
    }
    // Final refresh — row is still running.
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(200, runRow({ status: "running" })),
    );

    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await agents.create({ workspace: "ws_1" }).send("go");

    vi.useFakeTimers();
    const promise = consume(run.stream()).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toBeInstanceOf(NextTokenError);
    expect((result as Error).message).toMatch(/retry budget/);
  });

  it("propagates error after exhausting reconnect budget", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(202, runRow()));
    // All SSE attempts fail with a network error.
    fetchImpl.mockRejectedValue(new TypeError("fetch failed"));

    const agents = new Agents(new HttpClient({ apiKey: "k", fetchImpl }));
    const run = await agents.create({ workspace: "ws_1" }).send("go");

    vi.useFakeTimers();
    const promise = consume(run.stream()).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result).toBeInstanceOf(TypeError);
    // 1 send + 4 SSE attempts (1 initial + 3 retries) = 5
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});
