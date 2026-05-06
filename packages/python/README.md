# NextToken Python SDK

Official Python client for [NextToken](https://nexttoken.co) — agents, workspaces, search, fetch, integrations, and an OpenAI-compatible chat/embeddings gateway.

## Installation

```bash
pip install nexttoken
```

## Quick Start

```python
from nexttoken import NextToken

# Initialize with your API key
client = NextToken(api_key="your-api-key")

# Use like the OpenAI SDK
response = client.chat.completions.create(
    model="gpt-4o",  # or "claude-3-5-sonnet", "gemini-2.5-flash"
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

## Available Models

- OpenAI models
- Anthropic models
- Gemini models
- Openrouter models

## Embeddings

```python
from nexttoken import NextToken

client = NextToken(api_key="your-api-key")

response = client.embeddings.create(
    model="text-embedding-3-small",
    input="Your text to embed"
)

print(response.data[0].embedding)
```

## Integrations

Connect and use third-party services (Gmail, Slack, etc.) through your NextToken account.

```python
from nexttoken import NextToken

client = NextToken(api_key="your-api-key")

# List connected integrations
integrations = client.integrations.list()
print(integrations)

# List available actions for an app
actions = client.integrations.list_actions("gmail")
print(actions)

# Invoke a function
result = client.integrations.invoke(
    app="gmail",
    function_key="gmail-send-email",
    args={
        "to": "user@example.com",
        "subject": "Hello",
        "body": "Hello from NextToken!"
    }
)
print(result)
```

## Web Search

Search the web programmatically using NextToken's search API.

```python
from nexttoken import NextToken

client = NextToken(api_key="your-api-key")

# Basic search
results = client.search.query("latest AI developments")
for r in results:
    print(r["title"], r["url"])

# With domain filtering
results = client.search.query(
    "machine learning papers",
    num_results=10,
    include_domains=["arxiv.org", "nature.com"]
)
```

## Agents

Run the NextToken agent programmatically. Two entry points (multi-turn `Agent` session and one-shot `client.agents.run(...)`) backed by the same durable, server-side run. The `Run` handle is just an id — your code can pickle it, exit, and resume polling later.

```python
from nexttoken import NextToken

client = NextToken(api_key="your-api-key")

# Set up a workspace + data
ws = client.workspaces.create(name="Revenue analysis")
ws.upload("data.csv", "inputs/data.csv")

# Multi-turn session: same workspace + conversation across sends
agent = client.agents.create(workspace=ws, model="gpt-5")

run = agent.send("Analyze inputs/data.csv and write a report at report.md")
result = run.wait()                  # long-polls server-side, returns RunResult
print(result.final_text)

# Follow-up reuses the conversation automatically
result2 = agent.send("Now add a year-over-year comparison.").wait()

print(ws.read_text("report.md"))
```

```python
# One-shot — already have IDs
result = client.agents.run(
    "Summarize the key findings",
    workspace_id=ws.id,
    conversation_id=agent.conversation_id,  # optional: continue the thread
)
```

```python
# Reattach to a server-side run after a process restart
run = client.agents.get_run("run_abc123")
result = run.wait()
```

The `RunResult` includes:
- `status`: `"completed"`, `"failed"`, `"timeout"`, or `"cancelled"`
- `final_text`: text of the last assistant message (when available)
- `messages`: messages produced during this run (user + assistant + tool steps)
- `usage_estimate`: optional `{tokens_in, tokens_out}` (may be `None`)
- `duration_ms`, `error`, `started_at`, `completed_at`

`agent.send()` returns immediately with a `Run` handle — call `run.wait(timeout=...)` to block. Concurrent sends on the same `Agent` are not supported (use multiple `Agent` instances for fan-out).

## Workspaces

A workspace is a long-lived filesystem owned by your account. You upload files into it, agents run inside it, and you download the artifacts they produce.

```python
from nexttoken import NextToken

client = NextToken(api_key="your-api-key")

# Create a workspace
ws = client.workspaces.create(name="Revenue analysis")

# Upload data
ws.upload("data.csv", "inputs/data.csv")
ws.write_text("notes/instructions.md", "Use the year-over-year growth metric.")

# Inspect what's there
print(ws.list_files("inputs/"))
print(ws.exists("inputs/data.csv"))   # True

# Read text artifacts
print(ws.read_text("notes/instructions.md"))

# Download files (e.g. produced by an agent run)
ws.download("report.pdf", "report.pdf")

# Manage workspaces
all_workspaces = client.workspaces.list()
again = client.workspaces.get(ws.id)

# Delete (returns 409 if any agent run is currently active in this workspace)
ws.delete()
```

**Path rules.** Workspace paths are always relative — no leading `/`, no `..` segments. The workspace root is `""`.

## Get Your API Key

Sign up at [nexttoken.co](https://nexttoken.co) and get your API key from Settings.

## License

MIT
