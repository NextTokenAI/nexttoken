export interface ParsedSSEEvent {
  event: string;
  id: string | null;
  data: string;
}

/**
 * Parses an SSE byte stream into events. Mirrors Python's `_parse_sse_stream`:
 * recognizes `event:`, `id:`, `data:` (multi-line concatenated with `\n`),
 * skips comments (`:` prefix) and unknown fields, emits one event per
 * blank-line boundary, and flushes a trailing event without final blank line.
 *
 * The parser strips a single leading space after each field colon (per the
 * SSE spec); additional whitespace is preserved.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ParsedSSEEvent, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let curEvent = "message";
  let curId: string | null = null;
  let curData: string[] = [];
  let hasFields = false;

  function flush(): ParsedSSEEvent | null {
    if (!hasFields) return null;
    const ev: ParsedSSEEvent = {
      event: curEvent,
      id: curId,
      data: curData.join("\n"),
    };
    curEvent = "message";
    curId = null;
    curData = [];
    hasFields = false;
    return ev;
  }

  function processLine(line: string): ParsedSSEEvent | null {
    if (line === "") {
      return flush();
    }
    if (line.startsWith(":")) {
      // Comment / heartbeat — ignore.
      return null;
    }
    let field: string;
    let value: string;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colonIdx);
      value = line.slice(colonIdx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
    }
    if (field === "event") {
      curEvent = value;
      hasFields = true;
    } else if (field === "id") {
      curId = value === "" ? null : value;
      hasFields = true;
    } else if (field === "data") {
      curData.push(value);
      hasFields = true;
    }
    // Unknown fields (retry:, etc.) ignored.
    return null;
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = findLineBreak(buffer)) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + lineBreakLength(buffer, newlineIdx));
        const ev = processLine(line);
        if (ev) yield ev;
      }
    }

    // Flush decoder + remaining buffer.
    buffer += decoder.decode();
    if (buffer.length > 0) {
      let newlineIdx: number;
      while ((newlineIdx = findLineBreak(buffer)) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + lineBreakLength(buffer, newlineIdx));
        const ev = processLine(line);
        if (ev) yield ev;
      }
      if (buffer.length > 0) {
        const ev = processLine(buffer);
        if (ev) yield ev;
      }
    }

    const trailing = flush();
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function findLineBreak(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x0a) return i;
    if (c === 0x0d) return i;
  }
  return -1;
}

function lineBreakLength(s: string, idx: number): number {
  if (s.charCodeAt(idx) === 0x0d && s.charCodeAt(idx + 1) === 0x0a) return 2;
  return 1;
}
