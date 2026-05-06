# @nexttoken/cli

The official NextToken command-line interface. Run agents, manage workspaces, and connect your local machine as a runtime — all from one binary, with no manual API-key paste.

```bash
npx @nexttoken/cli agent run "Get a list of the top 10 ..."
```

After that the agent runs against a per-machine default workspace and streams output to your terminal.

## Install

```bash
# Run on demand without installing
npx @nexttoken/cli ...

# Or install globally
npm install -g @nexttoken/cli
nexttoken ...
```

Requires Node 18+. No native deps. The runtime binary (used by `nexttoken runtime`) is downloaded lazily on first invocation, not at install time.

## Subcommands

### `agent run` — invoke an agent

```bash
nexttoken agent run "<prompt>"                     # positional prompt (recommended)
nexttoken agent run -m "<prompt>"                  # alias
cat prompt.md | nexttoken agent run                # stdin
nexttoken agent run "<prompt>" --workspace ws_abc  # pin to a workspace
nexttoken agent run "<prompt>" --workspace=new     # one-off fresh workspace
nexttoken agent run "<prompt>" --model gpt-5
nexttoken agent run "<prompt>" --timeout 1200      # server-side cap, seconds
nexttoken agent run "<prompt>" --no-stream         # wait + print final text
nexttoken agent run "<prompt>" --json              # machine-readable
```

**Default workspace.** When `--workspace` is omitted, the CLI looks up or creates a per-machine workspace named `CLI Workspace · <hostname>`. The id is cached in `~/.nexttoken/state.json`, keyed by `<api-base-url>::<user-email>` so staging vs. prod and account switches never reuse a stale id.

**Output mode.** Streams tokens incrementally when stdout is a TTY (default). `--no-stream` waits and prints the final text only. `--json` emits one `RunResult` JSON object on stdout, with logs on stderr — suitable for `… --json | jq`.

### `agent get / cancel / stream`

```bash
nexttoken agent get <run_id>            # show status + ids
nexttoken agent cancel <run_id>         # idempotent; safe on already-terminal
nexttoken agent stream <run_id>         # re-attach to a run's SSE stream
```

### `workspace`

```bash
nexttoken workspace create [--name <n>]
nexttoken workspace ls
nexttoken workspace rm <ws_id>
nexttoken workspace upload <local_path> <ws_id>:<remote_path>
nexttoken workspace download <ws_id>:<remote_path> <local_path>
nexttoken workspace files <ws_id> [--path <p>] [--recursive]
```

All commands accept `--json`.

### `auth`

```bash
nexttoken auth login [--no-browser]    # browser sign-in
nexttoken auth logout [--all]          # remove active profile (or all)
nexttoken auth whoami [--json]         # show signed-in email + tag
```

**How it works.** `auth login` (and any command requiring auth in an interactive terminal) calls the backend to start an authorization session, gets back a short typeable code (e.g. `AB12-CD34`) and a sign-in URL, tries to open your browser at that URL, and polls the backend until you've completed sign-in. You sign in to NextToken in the browser as usual, click "Allow" on the "Authorize CLI on this machine?" page, and the CLI receives an API key over HTTPS — never via a URL or local listener. Same flow whether you're at a laptop or on SSH; auto-opening the browser is just a convenience on the laptop case.

```
$ nexttoken auth login
→ To authorize this CLI, visit:
   https://nexttoken.co/app/auth/cli-auth?user_code=AB12-CD34
   and enter code: AB12-CD34
   (We tried to open your browser automatically.)
→ Waiting for authorization (up to 15 minutes)…
✓ Signed in as you@example.com — credential saved to ~/.nexttoken/credentials.json
```

**Headless / SSH / Codespaces.** Pass `--no-browser` (or set `NEXTTOKEN_NO_BROWSER=1`) to skip the auto-open. The CLI still prints the URL + code; visit them on any device with a browser, click Allow, the CLI's poll picks up the result. Same code path as the laptop case — there's no separate "device code" flow to learn.

**Manual override / CI.** `--api-key=<value>` flag or `NEXTTOKEN_API_KEY` env var bypass interactive auth entirely. Always available; required in CI / non-interactive contexts (the CLI refuses to open a browser when stdout/stderr aren't TTYs or when `CI=1` — see [Auth resolution precedence](#auth-resolution-precedence)).

**Off-switch.** `NEXTTOKEN_CLI_BROWSER_AUTH=0` disables the implicit auth trigger entirely (useful when pointed at an older backend without `/cli-auth/*`). The CLI then exits 3 with a "set NEXTTOKEN_API_KEY" message instead of attempting the polling flow.

### `runtime` — connect your machine as an executor

```bash
nexttoken runtime [--workspace <dir>] [--name <n>]
nexttoken                                  # bare invocation runs this for back-compat
```

This downloads the NextToken Runtime binary on first use (cached at `~/.nexttoken/<version>/`), then spawns it. None of the other subcommands (`agent` / `workspace` / `auth`) ever touch the binary, so cold start for them is just Node startup + npm install.

## Auth resolution precedence

1. `--api-key=<value>` flag
2. `NEXTTOKEN_API_KEY` env var
3. `~/.nexttoken/credentials.json` (active profile, scoped to `--api-base-url`)
4. Trigger interactive auth (only when stdout *and* stderr are TTYs, `CI` is unset, and `--json` is not given)

In any non-interactive context — CI, piped output, `--json`, headless SSH — the CLI **does not** open a browser. It exits with `Authentication required. Set NEXTTOKEN_API_KEY or run \`nexttoken auth login\`.` and exit code 3.

## Credentials & state

Both files live under `~/.nexttoken/`:

```
~/.nexttoken/
├── credentials.json   # mode 0600 (POSIX); profile-keyed by base_url::email
├── state.json         # default workspace cache, also profile-keyed
└── <version>/<plat>/nexttoken-runtime    # runtime binary cache (lazy-downloaded)
```

`credentials.json` schema:

```json
{
  "profiles": {
    "https://api.nexttoken.co::john@example.com": {
      "api_key": "nt_...",
      "api_base_url": "https://api.nexttoken.co",
      "user_email": "john@example.com",
      "tag": "CLI · macbook-pro · 2026-05-06",
      "issued_at": "2026-05-06T10:00:00Z"
    }
  },
  "current": "https://api.nexttoken.co::john@example.com"
}
```

**Permissions.** On POSIX (macOS, Linux, WSL), the file is written `0600` and the CLI refuses to read it if perms are broader, with `chmod 600 ~/.nexttoken/credentials.json` as the repair instruction. On Windows, `chmod` is largely a no-op (NTFS uses ACLs, not POSIX modes); the file inherits your home-directory ACLs. On shared Windows boxes, prefer the `NEXTTOKEN_API_KEY` env-var path.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General / runtime error |
| `2` | Usage error (unknown flag, missing arg) |
| `3` | Authentication required / failed |
| `4` | Agent run failed / timed out / cancelled |
| `5` | Network / API unavailable |

Stable contract — script against these.

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `NEXTTOKEN_API_KEY` | Override credential resolution | — |
| `NEXTTOKEN_API_BASE_URL` | Override API base URL | `https://api.nexttoken.co` |
| `NEXTTOKEN_WEB_BASE_URL` | Override web app base (for `auth login`) | `https://nexttoken.co` |
| `NEXTTOKEN_NO_BROWSER` | `=1` skips the browser auto-open during `auth login` (CLI still polls; you visit the printed URL manually) | unset |
| `NEXTTOKEN_NO_INTERACTIVE` | `=1` disables implicit interactive auth | unset |
| `NEXTTOKEN_DEBUG` | `=1` prints stack traces on error | unset |
| `CI` | Any non-empty/non-`0` value disables interactive auth | unset |

## Debugging

```bash
NEXTTOKEN_DEBUG=1 nexttoken agent run "..."   # prints full stack on error
nexttoken auth whoami --json                  # confirm which profile is active
nexttoken --version                           # CLI version
```

## Architecture

The CLI is a thin layer over [`@nexttoken/sdk`](../typescript). All HTTP work lives in the SDK; the CLI handles arg parsing, credential resolution, browser opening, and output formatting.

```
packages/node/
├── index.js                 # arg dispatch
├── lib/
│   ├── auth.js              # ensureCredential() — resolution precedence
│   ├── auth_flow.js         # /cli-auth/start → optional browser auto-open → /cli-auth/poll
│   ├── credentials.js       # ~/.nexttoken/credentials.json (chmod 0600)
│   ├── state.js             # ~/.nexttoken/state.json
│   ├── default_workspace.js # cache → 404 fallthrough → create
│   ├── client.js            # build SDK client lazily
│   ├── exit_codes.js        # SDK error → exit code mapping
│   ├── interactive.js       # TTY / CI / --json gating
│   ├── stdin.js             # readStdinIfPiped()
│   ├── format.js            # human / JSON output
│   └── runtime.js           # ensureBinary + spawn
├── commands/
│   ├── agent.js
│   ├── workspace.js
│   ├── auth.js
│   └── runtime.js
└── tests/                   # node:test
```

## Local development

In source, `package.json` declares `"@nexttoken/sdk": "file:../typescript"` so `npm install` resolves the SDK from this repo's working tree. At `npm pack` / `npm publish` time, [scripts/prepack.js](./scripts/prepack.js) reads the SDK's current published version and rewrites the dep to `^X.Y.Z` for the tarball; [scripts/postpack.js](./scripts/postpack.js) restores the working-tree manifest immediately after. The published tarball therefore points at the npm-registry SDK; local dev keeps the file: dep working.

```bash
# In packages/typescript
npm install && npm run build      # build SDK dist/

# In packages/node
npm install                       # resolves @nexttoken/sdk via file:../typescript
npm test                          # 54 tests via node:test
node index.js --help              # try the CLI

# Inspect what would be published (dep gets swapped to ^X.Y.Z, then restored):
npm pack
tar -xOf nexttoken-cli-*.tgz package/package.json | grep '@nexttoken/sdk'
```

Publishing requires `@nexttoken/sdk` to already be on npm at the version `packages/typescript/package.json` declares — the prepack swap pins to that version, and `npm install` of the published CLI will fail if the SDK isn't resolvable.

## License

MIT — see [LICENSE](../../LICENSE).
