import { describe, expect, it } from "vitest";
import { parseSSEStream, type ParsedSSEEvent } from "../src/sse";

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(s));
      controller.close();
    },
  });
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect(
  gen: AsyncGenerator<ParsedSSEEvent, void, void>,
): Promise<ParsedSSEEvent[]> {
  const out: ParsedSSEEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("parseSSEStream", () => {
  it("parses a single message event with id and data", async () => {
    const stream = streamFromString(
      "event: message\nid: 7\ndata: {\"x\":1}\n\n",
    );
    const events = await collect(parseSSEStream(stream));
    expect(events).toEqual([
      { event: "message", id: "7", data: '{"x":1}' },
    ]);
  });

  it("treats missing event field as 'message' default", async () => {
    const stream = streamFromString("data: hello\n\n");
    const events = await collect(parseSSEStream(stream));
    expect(events[0]?.event).toBe("message");
    expect(events[0]?.data).toBe("hello");
  });

  it("concatenates multi-line data with newlines", async () => {
    const stream = streamFromString(
      "data: first\ndata: second\ndata: third\n\n",
    );
    const events = await collect(parseSSEStream(stream));
    expect(events[0]?.data).toBe("first\nsecond\nthird");
  });

  it("ignores comments (`:` prefix)", async () => {
    const stream = streamFromString(
      ": heartbeat\nevent: message\ndata: ok\n\n",
    );
    const events = await collect(parseSSEStream(stream));
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe("ok");
  });

  it("ignores unknown fields like retry:", async () => {
    const stream = streamFromString(
      "retry: 1000\nevent: message\ndata: hi\n\n",
    );
    const events = await collect(parseSSEStream(stream));
    expect(events).toHaveLength(1);
  });

  it("flushes a trailing event without final blank line", async () => {
    const stream = streamFromString("event: terminal\ndata: bye");
    const events = await collect(parseSSEStream(stream));
    expect(events).toEqual([{ event: "terminal", id: null, data: "bye" }]);
  });

  it("handles \\r\\n line endings", async () => {
    const stream = streamFromString(
      "event: message\r\nid: 1\r\ndata: a\r\n\r\n",
    );
    const events = await collect(parseSSEStream(stream));
    expect(events).toEqual([{ event: "message", id: "1", data: "a" }]);
  });

  it("handles split-mid-line chunk boundaries", async () => {
    const stream = streamFromChunks([
      "event: mes",
      "sage\nid: 4",
      "2\ndata: hel",
      "lo\n\n",
    ]);
    const events = await collect(parseSSEStream(stream));
    expect(events).toEqual([
      { event: "message", id: "42", data: "hello" },
    ]);
  });

  it("emits multiple events separated by blank lines", async () => {
    const stream = streamFromString(
      "event: message\nid: 1\ndata: a\n\nevent: message\nid: 2\ndata: b\n\nevent: terminal\ndata: done\n\n",
    );
    const events = await collect(parseSSEStream(stream));
    expect(events).toEqual([
      { event: "message", id: "1", data: "a" },
      { event: "message", id: "2", data: "b" },
      { event: "terminal", id: null, data: "done" },
    ]);
  });

  it("treats empty id: as null", async () => {
    const stream = streamFromString("id:\nevent: message\ndata: x\n\n");
    const events = await collect(parseSSEStream(stream));
    expect(events[0]?.id).toBeNull();
  });

  it("strips a single leading space after the colon (per spec)", async () => {
    const stream = streamFromString("data:  two-space\n\n");
    const events = await collect(parseSSEStream(stream));
    expect(events[0]?.data).toBe(" two-space");
  });
});
