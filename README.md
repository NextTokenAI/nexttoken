<p align="center">
  <h1 align="center">NextToken</h1>
  <p align="center">The AI agent platform for data analysis, automation, and full-stack app building.</p>
</p>

<p align="center">
  <a href="https://pypi.org/project/nexttoken/"><img src="https://img.shields.io/pypi/v/nexttoken" alt="PyPI"></a>
  <a href="https://www.npmjs.com/package/@nexttoken/sdk"><img src="https://img.shields.io/npm/v/@nexttoken/sdk?label=npm%20%40nexttoken%2Fsdk" alt="npm SDK"></a>
  <a href="https://www.npmjs.com/package/@nexttoken/cli"><img src="https://img.shields.io/npm/v/@nexttoken/cli?label=npm%20%40nexttoken%2Fcli" alt="npm CLI"></a>
  <a href="https://nexttoken.co/docs"><img src="https://img.shields.io/badge/docs-nexttoken.co-blue" alt="Docs"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/NextTokenAI/nexttoken" alt="License"></a>
</p>

---

## What is NextToken?

NextToken is an AI agent platform where you chat with an agent that executes Python and shell code, queries databases like Snowflake and PostgreSQL, calls leading LLMs through a single API, connects to 1000+ third-party apps, and builds full-stack web applications — all inside isolated, persistent workspaces.

Describe what you need in plain language and the agent handles the rest: writing code, running queries, generating visualizations, and deploying apps.

## Key Capabilities

- **Code Execution** — Run Python, shell commands, and Jupyter-style code in sandboxed environments with pre-installed data science packages.
- **Data Connectors** — Query Snowflake, Databricks, PostgreSQL, and AWS S3 directly from your workspace. No ETL required.
- **LLM Access** — Use GPT, Claude, and Gemini models through a single OpenAI-compatible API with your own keys.
- **1000+ Integrations** — Connect Gmail, Slack, GitHub, Notion, Google Sheets, and hundreds more via built-in Pipedream integrations.
- **App Building** — Build and share full-stack React + Python web applications without leaving the platform.
- **Local Runtime** — Run the agent on your own machine with full access to local files and resources.

## Packages

This repository contains the open-source client packages for NextToken:

| Package | Description | Install |
|---------|-------------|---------|
| [Python SDK](./packages/python) | Python client for agents, workspaces, search, integrations, and OpenAI-compatible chat | `pip install nexttoken` |
| [TypeScript SDK](./packages/typescript) | TypeScript / JavaScript client for agents, workspaces, search, and integrations | `npm install @nexttoken/sdk` |
| [CLI](./packages/node) | Run agents, manage workspaces, and connect your machine as a runtime — in one binary | `npx @nexttoken/cli agent run "..."` |

## Quick Start

### Python SDK

```python
from nexttoken import NextToken

client = NextToken(api_key="your-api-key")

response = client.chat.completions.create(
    model="gpt-4o",  # or "claude-3-5-sonnet", "gemini-2.5-flash"
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
```

Works with any OpenAI-compatible client — just point it at `https://gateway.nexttoken.co/v1`.

### TypeScript SDK

```ts
import { NextToken } from "@nexttoken/sdk";

const client = new NextToken({ apiKey: process.env.NEXTTOKEN_API_KEY! });

const ws = await client.workspaces.create("Revenue analysis");
await ws.writeText("inputs/data.csv", "month,revenue\n2024-01,120000");

const run = await client.agents
  .create({ workspace: ws })
  .send("Analyze inputs/data.csv and write a summary to outputs/summary.md.");

const result = await run.wait();
console.log(result.finalText);
```

For chat completions, install the official `openai` npm package and point it at `client.gatewayBaseUrl`. See the [TypeScript SDK README](./packages/typescript) for details.

### CLI

```bash
# Run an agent in one command (browser opens for first-run auth)
npx @nexttoken/cli agent run "Get a list of the top 10 ..."

# Manage workspaces, cancel runs, etc.
npx @nexttoken/cli workspace ls
npx @nexttoken/cli agent cancel <run_id>

# Connect your machine as a runtime (for code execution / file access)
npx @nexttoken/cli runtime --workspace ~/my-project
```

The CLI ships every NextToken capability — agents, workspaces, auth, and the local runtime — in one binary. The runtime binary is downloaded lazily on first use, so the agent / workspace paths stay near-instant.

## Documentation

Full documentation is available at [nexttoken.co/docs](https://nexttoken.co/docs).

| Guide | Description |
|-------|-------------|
| [Quickstart](https://nexttoken.co/docs/getting-started/quickstart) | Get up and running in minutes |
| [Code Execution](https://nexttoken.co/docs/features/code-execution) | Sandboxed environments, packages, and execution model |
| [Data Connectors](https://nexttoken.co/docs/data-connectors/overview) | Connect Snowflake, Databricks, PostgreSQL, and S3 |
| [LLM Providers](https://nexttoken.co/docs/integrations/llm-providers) | Supported models and API key setup |
| [App Building](https://nexttoken.co/docs/app-building/overview) | Build full-stack React + Python apps |
| [Python SDK](https://nexttoken.co/docs/sdk/quickstart) | SDK reference for chat completions, embeddings, and integrations |
| [TypeScript SDK](./packages/typescript/README.md) | TS / JS reference for agents, workspaces, and integrations |
| [CLI](./packages/node/README.md) | `nexttoken` command-line interface — agents, workspaces, auth, runtime |
| [Local Runtime](https://nexttoken.co/docs/local-runtime/overview) | Install and configure bring-your-own-compute |

## Community & Support

- [GitHub Issues](https://github.com/NextTokenAI/nexttoken/issues)
- Email: [contact@nexttoken.co](mailto:contact@nexttoken.co)

## Releasing

Each package is versioned and released independently. To publish a new version, push a git tag matching the package's prefix:

| Package | Tag prefix | Workflow |
|---------|------------|----------|
| Python SDK | `python-v*` (e.g. `python-v0.11.1`) | [.github/workflows/publish-python.yml](./.github/workflows/publish-python.yml) |
| TypeScript SDK | `ts-sdk-v*` (e.g. `ts-sdk-v0.1.1`) | [.github/workflows/publish-typescript.yml](./.github/workflows/publish-typescript.yml) |
| CLI | `node-v*` (e.g. `node-v0.2.2`) | [.github/workflows/publish-node.yml](./.github/workflows/publish-node.yml) |

Bump the version in the package's manifest first (`pyproject.toml` for Python, `package.json` for the others), commit, then tag and push. The workflow runs tests, builds, and publishes to PyPI / npm.

## License

MIT — see [LICENSE](./LICENSE).
