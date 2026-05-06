#!/usr/bin/env node
'use strict';

const { version: VERSION } = require('./package.json');
const { EXIT, exitCodeForError } = require('./lib/exit_codes');

const HELP = `
nexttoken — NextToken CLI

Usage:
  nexttoken agent run "<prompt>" [opts]   Run an agent (positional / -m / stdin)
  nexttoken agent get <run_id>            Show run status
  nexttoken agent cancel <run_id>         Cancel a run (idempotent)
  nexttoken agent stream <run_id>         Re-attach to a run's SSE stream

  nexttoken workspace create [--name n]   Create a workspace
  nexttoken workspace ls                  List your workspaces
  nexttoken workspace rm <ws_id>          Delete a workspace
  nexttoken workspace upload <local> <ws_id>:<remote>
  nexttoken workspace download <ws_id>:<remote> <local>
  nexttoken workspace files <ws_id>       List files in a workspace

  nexttoken runtime [opts]                Run NextToken Runtime locally
  nexttoken auth login [--no-browser]     Sign in
  nexttoken auth logout [--all]           Clear local credentials
  nexttoken auth whoami [--json]          Show current credential

  nexttoken --version | -v
  nexttoken --help    | -h

Auth resolution: --api-key flag → NEXTTOKEN_API_KEY env → ~/.nexttoken/credentials.json
                 → interactive auth (only when stdout/stderr are TTYs).
`.trim();

async function main() {
  const argv = process.argv.slice(2);

  // Bare `nexttoken` (no args) preserves back-compat: spawn the runtime
  // binary, lazy-downloading on first use.
  if (argv.length === 0) {
    const runtime = require('./commands/runtime');
    return await runtime.run([]);
  }

  // Top-level flags handled before subcommand dispatch.
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`nexttoken ${VERSION}\n`);
    return EXIT.OK;
  }
  if (argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP + '\n');
    return EXIT.OK;
  }

  const [sub, ...rest] = argv;

  // Lazy-load subcommand modules so cold start is minimal.
  if (sub === 'agent') {
    const cmd = require('./commands/agent');
    return await cmd.run(rest);
  }
  if (sub === 'workspace') {
    const cmd = require('./commands/workspace');
    return await cmd.run(rest);
  }
  if (sub === 'auth') {
    const cmd = require('./commands/auth');
    return await cmd.run(rest);
  }
  if (sub === 'runtime') {
    const cmd = require('./commands/runtime');
    return await cmd.run(rest);
  }

  process.stderr.write(`Unknown command: ${sub}\n\n`);
  process.stderr.write(HELP + '\n');
  return EXIT.USAGE;
}

main()
  .then((code) => process.exit(typeof code === 'number' ? code : EXIT.OK))
  .catch((err) => {
    const code = (err && typeof err.exitCode === 'number') ? err.exitCode : exitCodeForError(err);
    if (err && err.message) process.stderr.write(`${err.message}\n`);
    if (process.env.NEXTTOKEN_DEBUG && err && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    process.exit(code);
  });
