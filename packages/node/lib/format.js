'use strict';

/**
 * Human-readable formatters that go to stdout. Always raw (no chalk).
 * --json output is handled by the command directly so logs can go to
 * stderr and the JSON object is the only thing on stdout.
 */

function printJSON(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function printError(message) {
  process.stderr.write(`${message}\n`);
}

function printInfo(message) {
  process.stderr.write(`${message}\n`);
}

function formatWorkspace(ws) {
  return `${ws.id}\t${ws.name || ''}\t${ws.createdAt || ''}`;
}

function formatRunHeader(run) {
  return `run_id=${run.runId} status=${run.lastKnownStatus || '?'} workspace=${run.workspaceId}`;
}

module.exports = { printJSON, printError, printInfo, formatWorkspace, formatRunHeader };
