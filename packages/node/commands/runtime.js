'use strict';

const { spawnRuntime } = require('../lib/runtime');
const { EXIT } = require('../lib/exit_codes');

/**
 * `nexttoken runtime [args...]` and the bare `nexttoken` (no subcommand)
 * both end up here. ensureBinary() is gated behind this command so the
 * `agent` / `workspace` / `auth` paths never download anything.
 */
async function run(argv) {
  return await spawnRuntime(argv);
}

module.exports = { run, EXIT };
