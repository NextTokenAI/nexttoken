import type { HttpClient } from "./http.js";

export interface FileItem {
  name: string;
  type: "file" | "directory";
}

export interface UploadResult {
  path: string;
  bytes: number;
}

export interface ListFilesOptions {
  recursive?: boolean;
}

export interface ReadTextOptions {
  maxBytes?: number;
}

interface WorkspaceData {
  id: string;
  name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface WorkspaceListResponse {
  workspaces?: WorkspaceData[];
}

interface ListFilesResponse {
  workspace_id: string;
  path: string;
  items?: FileItem[];
}

interface FileExistsResponse {
  exists: boolean;
  type?: "file" | "directory";
}

interface ReadTextResponse {
  workspace_id: string;
  path: string;
  content: string;
}

export class Workspace {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  private readonly client: Workspaces;

  constructor(data: WorkspaceData, client: Workspaces) {
    this.id = data.id;
    this.name = data.name ?? null;
    this.createdAt = data.created_at ?? null;
    this.updatedAt = data.updated_at ?? null;
    this.client = client;
  }

  upload(localPath: string, remotePath: string): Promise<UploadResult> {
    return this.client.upload(this.id, localPath, remotePath);
  }

  download(remotePath: string, localPath: string): Promise<number> {
    return this.client.download(this.id, remotePath, localPath);
  }

  readText(remotePath: string, opts: ReadTextOptions = {}): Promise<string> {
    return this.client.readText(this.id, remotePath, opts);
  }

  writeText(remotePath: string, content: string): Promise<void> {
    return this.client.writeText(this.id, remotePath, content);
  }

  exists(remotePath: string): Promise<boolean> {
    return this.client.exists(this.id, remotePath);
  }

  listFiles(
    path = "",
    opts: ListFilesOptions = {},
  ): Promise<FileItem[]> {
    return this.client.listFiles(this.id, path, opts);
  }

  deleteFile(remotePath: string): Promise<void> {
    return this.client.deleteFile(this.id, remotePath);
  }

  delete(): Promise<void> {
    return this.client.delete(this.id);
  }

  toString(): string {
    return `Workspace(id=${this.id}, name=${this.name})`;
  }
}

export class Workspaces {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  async create(name?: string | null): Promise<Workspace> {
    const body: Record<string, unknown> = {};
    if (name !== undefined && name !== null) body["name"] = name;
    const data = await this.http.postJson<WorkspaceData>("/workspaces", body);
    return new Workspace(data, this);
  }

  async list(): Promise<Workspace[]> {
    const data = await this.http.getJson<WorkspaceListResponse>("/workspaces");
    return (data.workspaces ?? []).map((w) => new Workspace(w, this));
  }

  async get(workspaceId: string): Promise<Workspace> {
    const data = await this.http.getJson<WorkspaceData>(
      `/workspaces/${encodeURIComponent(workspaceId)}`,
    );
    return new Workspace(data, this);
  }

  async delete(workspaceId: string): Promise<void> {
    await this.http.deleteEmpty(
      `/workspaces/${encodeURIComponent(workspaceId)}`,
    );
  }

  async upload(
    workspaceId: string,
    localPath: string,
    remotePath: string,
  ): Promise<UploadResult> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const buf = await fs.readFile(localPath);
    const basename = path.basename(localPath);
    const form = new FormData();
    form.append("file", new Blob([buf]), basename);
    return this.http.postMultipart<UploadResult>(
      `/workspaces/${encodeURIComponent(workspaceId)}/files`,
      form,
      { query: { path: remotePath } },
    );
  }

  async download(
    workspaceId: string,
    remotePath: string,
    localPath: string,
  ): Promise<number> {
    const fs = await import("node:fs");
    const fsp = await import("node:fs/promises");
    const path = await import("node:path");
    const stream = await import("node:stream");
    const { body } = await this.http.getStream(
      `/workspaces/${encodeURIComponent(workspaceId)}/files/content`,
      { query: { path: remotePath } },
    );

    const dir = path.dirname(path.resolve(localPath));
    if (dir) await fsp.mkdir(dir, { recursive: true });

    const out = fs.createWriteStream(localPath);
    let total = 0;
    const reader = body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (!out.write(value)) {
          await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        out.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
      void stream;
    }
    return total;
  }

  async listFiles(
    workspaceId: string,
    path = "",
    opts: ListFilesOptions = {},
  ): Promise<FileItem[]> {
    const data = await this.http.getJson<ListFilesResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/files`,
      { query: { path, recursive: opts.recursive ? "true" : "false" } },
    );
    return data.items ?? [];
  }

  async deleteFile(workspaceId: string, remotePath: string): Promise<void> {
    await this.http.deleteEmpty(
      `/workspaces/${encodeURIComponent(workspaceId)}/files`,
      { query: { path: remotePath } },
    );
  }

  async exists(workspaceId: string, remotePath: string): Promise<boolean> {
    const data = await this.http.getJson<FileExistsResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/files/exists`,
      { query: { path: remotePath } },
    );
    return Boolean(data.exists);
  }

  async readText(
    workspaceId: string,
    remotePath: string,
    opts: ReadTextOptions = {},
  ): Promise<string> {
    const data = await this.http.getJson<ReadTextResponse>(
      `/workspaces/${encodeURIComponent(workspaceId)}/files/text`,
      { query: { path: remotePath, max_bytes: opts.maxBytes ?? 1_000_000 } },
    );
    return data.content;
  }

  async writeText(
    workspaceId: string,
    remotePath: string,
    content: string,
  ): Promise<void> {
    await this.http.putJson<void>(
      `/workspaces/${encodeURIComponent(workspaceId)}/files/text`,
      { path: remotePath, content },
    );
  }
}
