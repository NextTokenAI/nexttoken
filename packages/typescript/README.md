# @nexttoken/sdk

Official TypeScript SDK for [NextToken](https://nexttoken.co) — agents, workspaces, search, fetch, integrations.

```bash
npm install @nexttoken/sdk
```

Requires Node 18+ (or any runtime with native `fetch`, `ReadableStream`, `Blob`, `FormData`). Zero runtime dependencies.

## Quick start

```ts
import { NextToken } from "@nexttoken/sdk";

const client = new NextToken({ apiKey: process.env.NEXTTOKEN_API_KEY! });

const ws = await client.workspaces.create("Revenue analysis");
await ws.writeText("inputs/data.csv", "month,revenue\n2024-01,120000");

const agent = client.agents.create({ workspace: ws });
const run = await agent.send(
  "Read inputs/data.csv and write a one-paragraph summary to outputs/summary.md.",
);
const result = await run.wait();

console.log(result.status, result.finalText);
console.log(await ws.readText("outputs/summary.md"));
```

The SDK is async-by-default: every call that touches the network returns a `Promise`.

## Agents

```ts
const agent = client.agents.create({ workspace: ws, model: "gpt-5" });

// Multi-turn — agent remembers the conversation.
const r1 = await agent.send("Plot revenue by month.");
await r1.wait();

const r2 = await agent.send("Now annotate the YoY trend.");
await r2.wait();

// One-shot.
const result = await client.agents.run("Summarize key findings.", {
  workspaceId: ws.id,
});

// Reattach to a server-side run from another process.
const run = await client.agents.getRun("run_abc123");
const final = await run.wait();
```

### `Run.wait()` vs `Run.stream()`

- **`wait({ timeoutMs })`** — blocks (via long-poll) until the run reaches a terminal state. Returns a `RunResult` with `finalText`, `messages`, `usageEstimate`, etc. Throws `TimeoutError` if `timeoutMs` is exceeded.
- **`stream()`** — async iterator over `RunEvent`s. First yields the message replay (so a late subscriber doesn't miss output), then live messages, then a single `{ type: "terminal" }` event. Auto-reconnects on transient disconnects via `Last-Event-ID` (3 attempts, exponential backoff capped at 5s). After the budget, the loop refreshes the row once: if the run has gone terminal, a synthetic `terminal` event is emitted so the `for await` loop closes correctly; otherwise `stream()` throws `NextTokenError` so callers can't silently exit thinking the run finished.

```ts
for await (const ev of run.stream()) {
  if (ev.type === "message") {
    console.log(ev.data.role, ev.data.content);
  } else if (ev.type === "terminal") {
    console.log("done:", ev.data.status);
  }
}
```

### `Run.cancel()`

Idempotent. Calling on an already-terminal run is a no-op (returns the current row). Returns `this` for chaining.

```ts
await run.cancel();
const result = await run.wait();           // confirm terminal status
console.log(result.status);                // "cancelled"
```

## Workspaces

```ts
// CRUD
const ws = await client.workspaces.create("Demo");
const all = await client.workspaces.list();
const same = await client.workspaces.get(ws.id);
await ws.delete();                          // 409 ConflictError if active task

// Files (paths are workspace-relative; no leading "/" or "..")
await ws.upload("local/path.csv", "inputs/data.csv");
await ws.writeText("notes.md", "hello");
const text = await ws.readText("notes.md");
const items = await ws.listFiles("inputs/", { recursive: true });
const exists = await ws.exists("inputs/data.csv");
const bytes = await ws.download("outputs/report.pdf", "./report.pdf");
await ws.deleteFile("notes.md");
```

Upload uses multipart `FormData` over native `fetch`; download streams the response body to disk via Node's Web Streams.

## Search, Fetch, Integrations

```ts
// Web search.
const results = await client.search.query("latest AI developments", {
  numResults: 10,
  includeDomains: ["arxiv.org"],
});

// Fetch a URL as clean markdown.
const page = await client.fetch.url("https://example.com/article", {
  outputFormat: "markdown",
});

// Pipedream integrations.
const apps = await client.integrations.list();
const actions = await client.integrations.listActions("gmail");
const out = await client.integrations.invoke("gmail", "gmail-send-email", {
  to: "user@example.com",
  subject: "Hi",
  body: "Hello!",
});
```

## Errors

Every non-2xx response throws a typed error from `@nexttoken/sdk`:

| Status | Error |
|--------|-------|
| 400 | `BadRequestError` |
| 401 | `AuthError` |
| 402 | `InsufficientCreditsError` |
| 404 | `NotFoundError` |
| 409 | `ConflictError` |
| 413 | `PayloadTooLargeError` |
| 429 (cap) | `RunCapExceededError` (carries `tier`, `cap`, `scope`) |
| 429 (rate) | `RateLimitError` |
| 5xx | `ServerError` |
| other | `APIError` |

All extend `APIError` (which extends `NextTokenError`). Each carries `status`, `detail`, and `requestId` (from the `x-request-id` response header) so you can grep server logs for a failed call.

```ts
import { ConflictError, NotFoundError } from "@nexttoken/sdk";

try {
  await ws.delete();
} catch (err) {
  if (err instanceof ConflictError) {
    console.log("Wait for the running agent to finish, then retry.");
  } else if (err instanceof NotFoundError) {
    console.log("Already deleted.");
  } else {
    throw err;
  }
}
```

`Run.wait({ timeoutMs })` throws a separate `TimeoutError` (client-side wall-clock cap), distinct from `status === "timeout"` (server-side run timeout returned in `RunResult`).

## Configuration

```ts
new NextToken({
  apiKey: "nt_...",                            // or NEXTTOKEN_API_KEY env var
  baseUrl: "https://api.nexttoken.co",         // or NEXTTOKEN_API_BASE_URL env var
  fetchImpl: customFetch,                      // optional fetch override (testing, proxies, etc.)
});
```

Environment variables:

| Var | Default | Used for |
|-----|---------|----------|
| `NEXTTOKEN_API_KEY` | — | Bearer token |
| `NEXTTOKEN_API_BASE_URL` | `https://api.nexttoken.co` | All SDK calls |
| `NEXTTOKEN_GATEWAY_BASE_URL` | `https://gateway.nexttoken.co/v1` | OpenAI-compatible chat (read-only on `client.gatewayBaseUrl`) |

## Using chat completions (`openai` npm package)

The TS SDK does **not** wrap chat / embeddings / models. Install the official `openai` package and point it at `client.gatewayBaseUrl`:

```ts
import OpenAI from "openai";
import { NextToken } from "@nexttoken/sdk";

const nt = new NextToken({ apiKey: process.env.NEXTTOKEN_API_KEY! });
const openai = new OpenAI({ apiKey: nt.apiKey, baseURL: nt.gatewayBaseUrl });

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);
```

This keeps the SDK install lean — no transitive deps for users who only need agents.

## Concept parity with the Python SDK

The TS SDK mirrors the [Python SDK](../python) one-for-one for agents/workspaces/search/fetch/integrations. Differences:

- **camelCase vs snake_case.** TS uses camelCase for inputs and result fields (`numResults`, `finalText`, `runId`); the wire format remains snake_case and is translated at the boundary.
- **`Run.status`** is exposed as the synchronous `lastKnownStatus` getter (returns the cached value, possibly `null` before the first network call) plus an explicit `refresh()`/`done()` pair. Python's `status` property does a hidden HTTP call on first access; TS keeps async behavior explicit.
- **No chat/embeddings/models** in v1 (use `openai` directly per snippet above).
- **No `Email`** in v1.

## Examples

A runnable end-to-end flow lives at [examples/agent_run_basic.ts](./examples/agent_run_basic.ts). From `packages/typescript/`:

```bash
npm install
export NEXTTOKEN_API_KEY=nt_...
npx tsx examples/agent_run_basic.ts
```

The script exercises workspace create → upload → agent run → download. Set `NEXTTOKEN_EXAMPLE_TEST_STREAM=1` or `NEXTTOKEN_EXAMPLE_TEST_CANCEL=1` to also exercise `Run.stream()` / `Run.cancel()`.

## License

MIT — see [LICENSE](../../LICENSE).
