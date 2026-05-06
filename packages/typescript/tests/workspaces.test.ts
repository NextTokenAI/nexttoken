import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpClient } from "../src/http";
import { Workspaces } from "../src/workspaces";
import { ConflictError } from "../src/errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "nexttoken-test-"));
});
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Workspaces CRUD", () => {
  it("create() POSTs to /workspaces and returns Workspace handle", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        id: "ws_1",
        name: "Demo",
        created_at: "2026-05-05",
        updated_at: "2026-05-05",
      }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    const w = await ws.create("Demo");
    expect(w.id).toBe("ws_1");
    expect(w.name).toBe("Demo");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.nexttoken.co/workspaces");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "Demo",
    });
  });

  it("create() omits name when not given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, { id: "ws_1" }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    await ws.create();
    expect(JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string,
    )).toEqual({});
  });

  it("list() unwraps workspaces array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { workspaces: [{ id: "a" }, { id: "b" }] }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    const list = await ws.list();
    expect(list.map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("get() URL-encodes the id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { id: "ws/with slash" }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    await ws.get("ws/with slash");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.nexttoken.co/workspaces/ws%2Fwith%20slash",
    );
  });

  it("delete() returns 409 ConflictError when active task", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, { detail: "Active task" }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    await expect(ws.delete("ws_1")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("Workspace handle methods delegate to collection", () => {
  it("Workspace.upload calls collection upload with workspace id", async () => {
    const localFile = join(tempDir, "data.csv");
    writeFileSync(localFile, "col1,col2\n1,2");

    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(201, { id: "ws_1" }));
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(201, { path: "inputs/data.csv", bytes: 12 }),
    );

    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    const w = await ws.create("Demo");
    const res = await w.upload(localFile, "inputs/data.csv");
    expect(res).toEqual({ path: "inputs/data.csv", bytes: 12 });
  });
});

describe("Upload (multipart)", () => {
  it("sends FormData with file blob + path query param", async () => {
    const localFile = join(tempDir, "data.csv");
    writeFileSync(localFile, "hello world");

    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, { path: "x/data.csv", bytes: 11 }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    await ws.upload("ws_1", localFile, "x/data.csv");

    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(url as string);
    expect(u.pathname).toBe("/workspaces/ws_1/files");
    expect(u.searchParams.get("path")).toBe("x/data.csv");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const form = (init as RequestInit).body as FormData;
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).size).toBe(11);
  });
});

describe("Download (streaming)", () => {
  it("streams response body to local file and returns total bytes", async () => {
    const payload = new TextEncoder().encode("chunk1-chunk2-chunk3");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload.slice(0, 7));
        controller.enqueue(payload.slice(7, 14));
        controller.enqueue(payload.slice(14));
        controller.close();
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200 }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));

    const dest = join(tempDir, "nested", "out.bin");
    const total = await ws.download("ws_1", "remote.bin", dest);
    expect(total).toBe(payload.byteLength);
    expect(readFileSync(dest, "utf8")).toBe("chunk1-chunk2-chunk3");
  });
});

describe("File ops (text + stat + list + delete)", () => {
  it("listFiles() builds path + recursive query", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        workspace_id: "ws_1",
        path: "inputs",
        items: [{ name: "a.csv", type: "file" }],
      }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    const items = await ws.listFiles("ws_1", "inputs", { recursive: true });
    expect(items).toEqual([{ name: "a.csv", type: "file" }]);
    const u = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(u.searchParams.get("path")).toBe("inputs");
    expect(u.searchParams.get("recursive")).toBe("true");
  });

  it("exists() returns boolean", async () => {
    const fetchImpl = vi.fn();
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { exists: true }));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { exists: false }));
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    expect(await ws.exists("ws_1", "a.txt")).toBe(true);
    expect(await ws.exists("ws_1", "b.txt")).toBe(false);
  });

  it("readText() unwraps content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        workspace_id: "ws_1",
        path: "x.md",
        content: "hello",
      }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    expect(await ws.readText("ws_1", "x.md")).toBe("hello");
    const u = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(u.searchParams.get("max_bytes")).toBe("1000000");
  });

  it("readText() respects custom maxBytes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { content: "x", workspace_id: "ws_1", path: "p" }),
    );
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    await ws.readText("ws_1", "p", { maxBytes: 500 });
    const u = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(u.searchParams.get("max_bytes")).toBe("500");
  });

  it("writeText() PUTs JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(204));
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    await ws.writeText("ws_1", "p", "content");
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      path: "p",
      content: "content",
    });
  });

  it("deleteFile() sends DELETE with path query", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(204));
    const ws = new Workspaces(new HttpClient({ apiKey: "k", fetchImpl }));
    await ws.deleteFile("ws_1", "x");
    const u = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(u.searchParams.get("path")).toBe("x");
    expect((fetchImpl.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });
});
