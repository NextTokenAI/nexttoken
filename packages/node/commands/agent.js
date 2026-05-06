'use strict';

const mri = require('mri');

const { ensureCredential } = require('../lib/auth');
const { buildClient } = require('../lib/client');
const { ensureDefaultWorkspace } = require('../lib/default_workspace');
const { readStdinIfPiped } = require('../lib/stdin');
const { isInteractive } = require('../lib/interactive');
const { printJSON, printError, printInfo } = require('../lib/format');
const { EXIT, exitCodeForRunStatus } = require('../lib/exit_codes');
const { validateFlags, readNoFlag } = require('../lib/flags');

// mri auto-negates `--no-foo` into a `foo: false` parsed key, so we must
// allow both forms (`no-browser` AND `browser`, `no-stream` AND `stream`).
const COMMON_FLAGS = ['_', 'api-key', 'api-base-url', 'no-browser', 'browser', 'json'];
const RUN_FLAGS = [...COMMON_FLAGS, 'no-stream', 'stream', 'workspace', 'w', 'model', 'message', 'm', 'timeout'];
const GET_FLAGS = COMMON_FLAGS;
const CANCEL_FLAGS = COMMON_FLAGS;
const STREAM_FLAGS = COMMON_FLAGS.filter((f) => f !== 'json');

const HELP = `
Usage:
  nexttoken agent run "<prompt>" [--workspace <id>] [--model <m>]
                                  [--timeout <s>] [--no-stream] [--json]
  nexttoken agent run -m "<prompt>" ...           # alias for positional prompt
  cat prompt.md | nexttoken agent run             # stdin form
  nexttoken agent get <run_id> [--json]
  nexttoken agent cancel <run_id> [--json]
  nexttoken agent stream <run_id>
`.trim();

async function run(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === '-h' || sub === '--help') {
    process.stdout.write(HELP + '\n');
    return EXIT.OK;
  }
  if (sub === 'run') return await runAgent(rest);
  if (sub === 'get') return await getRun(rest);
  if (sub === 'cancel') return await cancelRun(rest);
  if (sub === 'stream') return await streamRun(rest);
  printError(`Unknown subcommand: nexttoken agent ${sub}`);
  process.stderr.write(HELP + '\n');
  return EXIT.USAGE;
}

async function runAgent(argv) {
  const flags = mri(argv, {
    boolean: ['no-stream', 'json', 'no-browser'],
    string: ['workspace', 'model', 'message', 'api-key', 'api-base-url', 'timeout'],
    alias: { m: 'message', w: 'workspace' },
  });
  validateFlags(flags, RUN_FLAGS, 'nexttoken agent run');
  const positional = flags._;

  // Resolve prompt: positional > -m/--message > stdin (when piped).
  let prompt = positional.length > 0 ? positional.join(' ') : null;
  if (flags.message) {
    if (prompt !== null) {
      printError('Provide a prompt as a positional arg or with -m, not both.');
      return EXIT.USAGE;
    }
    prompt = String(flags.message);
  }
  if (prompt === null) {
    prompt = await readStdinIfPiped();
  }
  if (prompt === null || prompt.trim() === '') {
    printError('No prompt provided. Pass as a positional arg, with -m, or pipe via stdin.');
    process.stderr.write(HELP + '\n');
    return EXIT.USAGE;
  }

  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);

  // Resolve workspace.
  let workspaceId;
  if (flags.workspace && flags.workspace !== 'new') {
    workspaceId = flags.workspace;
  } else if (flags.workspace === 'new') {
    const ws = await client.workspaces.create();
    workspaceId = ws.id;
  } else {
    if (!cred.userEmail) {
      // We have an env/flag credential but no email — can't profile-key the cache.
      // Fall back to creating-or-reusing without caching by listing.
      const all = await client.workspaces.list();
      const name = `CLI Workspace · ${require('os').hostname()}`;
      const existing = all.find((w) => w.name === name);
      const ws = existing || await client.workspaces.create(name);
      workspaceId = ws.id;
    } else {
      const ws = await ensureDefaultWorkspace(client, {
        apiBaseUrl: cred.apiBaseUrl,
        userEmail: cred.userEmail,
      });
      workspaceId = ws.id;
    }
  }

  const timeoutSeconds = flags.timeout ? Number(flags.timeout) : undefined;
  const sendOpts = {};
  if (timeoutSeconds !== undefined) sendOpts.timeoutSeconds = timeoutSeconds;

  const agent = client.agents.create(
    flags.model
      ? { workspace: workspaceId, model: flags.model }
      : { workspace: workspaceId },
  );
  const runHandle = await agent.send(prompt, sendOpts);

  // Output mode.
  if (flags.json) {
    const result = await runHandle.wait();
    printJSON(result);
    return exitCodeForRunStatus(result.status);
  }

  const wantStream = !readNoFlag(flags, 'stream') && isInteractive({ json: flags.json });
  if (!wantStream) {
    const result = await runHandle.wait();
    if (result.finalText) process.stdout.write(result.finalText + '\n');
    if (result.error) printError(result.error);
    return exitCodeForRunStatus(result.status);
  }

  // Stream by default for human / TTY output.
  printInfo(`→ run_id=${runHandle.runId}, streaming…`);
  let lastSeq = -1;
  let terminalStatus = null;
  let terminalError = null;
  for await (const ev of runHandle.stream()) {
    if (ev.type === 'message') {
      const seq = typeof ev.data.sequence === 'number' ? ev.data.sequence : lastSeq + 1;
      lastSeq = seq;
      const role = String(ev.data.role || '?');
      const content = String(ev.data.content || '');
      // Show one line per message with role prefix; final assistant text is the last block.
      process.stdout.write(`[${role}] ${content}\n`);
    } else if (ev.type === 'terminal') {
      terminalStatus = String(ev.data.status || 'unknown');
      if (ev.data.error) terminalError = String(ev.data.error);
    }
  }
  if (terminalError) printError(terminalError);
  return exitCodeForRunStatus(terminalStatus || 'unknown');
}

async function getRun(argv) {
  const flags = mri(argv, {
    boolean: ['json', 'no-browser'],
    string: ['api-key', 'api-base-url'],
  });
  validateFlags(flags, GET_FLAGS, 'nexttoken agent get');
  const positional = flags._;
  if (positional.length < 1) {
    printError('Usage: nexttoken agent get <run_id>');
    return EXIT.USAGE;
  }
  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);
  const handle = await client.agents.getRun(positional[0]);
  // Refresh to pick up the latest known status; if still non-terminal,
  // `wait` would block — `get` is fire-and-return.
  await handle.refresh();
  if (flags.json) {
    printJSON({
      run_id: handle.runId,
      workspace_id: handle.workspaceId,
      conversation_id: handle.conversationId,
      status: handle.lastKnownStatus,
    });
  } else {
    process.stdout.write(`run_id=${handle.runId} status=${handle.lastKnownStatus} ` +
                         `workspace=${handle.workspaceId} conversation=${handle.conversationId}\n`);
  }
  return EXIT.OK;
}

async function cancelRun(argv) {
  const flags = mri(argv, {
    boolean: ['json', 'no-browser'],
    string: ['api-key', 'api-base-url'],
  });
  validateFlags(flags, CANCEL_FLAGS, 'nexttoken agent cancel');
  const positional = flags._;
  if (positional.length < 1) {
    printError('Usage: nexttoken agent cancel <run_id>');
    return EXIT.USAGE;
  }
  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);
  const handle = await client.agents.getRun(positional[0]);
  await handle.cancel();
  if (flags.json) {
    printJSON({ run_id: handle.runId, status: handle.lastKnownStatus });
  } else {
    process.stdout.write(`✓ Cancel issued — run ${handle.runId} status: ${handle.lastKnownStatus}\n`);
  }
  return EXIT.OK;
}

async function streamRun(argv) {
  const flags = mri(argv, {
    boolean: ['no-browser'],
    string: ['api-key', 'api-base-url'],
  });
  validateFlags(flags, STREAM_FLAGS, 'nexttoken agent stream');
  const positional = flags._;
  if (positional.length < 1) {
    printError('Usage: nexttoken agent stream <run_id>');
    return EXIT.USAGE;
  }
  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);
  const handle = await client.agents.getRun(positional[0]);
  let terminalStatus = null;
  for await (const ev of handle.stream()) {
    if (ev.type === 'message') {
      const role = String(ev.data.role || '?');
      const content = String(ev.data.content || '');
      process.stdout.write(`[${role}] ${content}\n`);
    } else if (ev.type === 'terminal') {
      terminalStatus = String(ev.data.status || 'unknown');
    }
  }
  return exitCodeForRunStatus(terminalStatus || 'unknown');
}

module.exports = { run };
