'use strict';

const mri = require('mri');

const { ensureCredential } = require('../lib/auth');
const { buildClient } = require('../lib/client');
const { printJSON, printError, printInfo } = require('../lib/format');
const { EXIT } = require('../lib/exit_codes');
const { validateFlags } = require('../lib/flags');

// `browser` covers mri's auto-negation of `--no-browser` (key becomes `browser: false`).
const COMMON_FLAGS = ['_', 'api-key', 'api-base-url', 'no-browser', 'browser', 'json'];
const CREATE_FLAGS = [...COMMON_FLAGS, 'name'];
const FILES_FLAGS = [...COMMON_FLAGS, 'recursive', 'path'];

const HELP = `
Usage:
  nexttoken workspace create [--name <n>] [--json]
  nexttoken workspace ls [--json]
  nexttoken workspace rm <workspace_id>
  nexttoken workspace upload <local_path> <ws_id>:<remote_path>
  nexttoken workspace download <ws_id>:<remote_path> <local_path>
  nexttoken workspace files <ws_id> [--path <p>] [--recursive] [--json]
`.trim();

async function run(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === '-h' || sub === '--help') {
    process.stdout.write(HELP + '\n');
    return EXIT.OK;
  }
  if (sub === 'create') return await create(rest);
  if (sub === 'ls' || sub === 'list') return await list(rest);
  if (sub === 'rm' || sub === 'delete') return await remove(rest);
  if (sub === 'upload') return await upload(rest);
  if (sub === 'download') return await download(rest);
  if (sub === 'files' || sub === 'ls-files') return await files(rest);
  printError(`Unknown subcommand: nexttoken workspace ${sub}`);
  process.stderr.write(HELP + '\n');
  return EXIT.USAGE;
}

async function create(argv) {
  const flags = mri(argv, {
    boolean: ['json', 'no-browser'],
    string: ['name', 'api-key', 'api-base-url'],
  });
  validateFlags(flags, CREATE_FLAGS, 'nexttoken workspace create');
  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);
  const ws = await client.workspaces.create(flags.name);
  if (flags.json) printJSON(serializeWorkspace(ws));
  else process.stdout.write(`${ws.id}\t${ws.name || ''}\n`);
  return EXIT.OK;
}

async function list(argv) {
  const flags = mri(argv, {
    boolean: ['json', 'no-browser'],
    string: ['api-key', 'api-base-url'],
  });
  validateFlags(flags, COMMON_FLAGS, 'nexttoken workspace ls');
  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);
  const all = await client.workspaces.list();
  if (flags.json) {
    printJSON(all.map(serializeWorkspace));
  } else {
    if (all.length === 0) {
      printInfo('(no workspaces)');
    } else {
      for (const ws of all) {
        process.stdout.write(`${ws.id}\t${ws.name || ''}\t${ws.createdAt || ''}\n`);
      }
    }
  }
  return EXIT.OK;
}

async function remove(argv) {
  const flags = mri(argv, {
    boolean: ['json', 'no-browser'],
    string: ['api-key', 'api-base-url'],
  });
  validateFlags(flags, COMMON_FLAGS, 'nexttoken workspace rm');
  const positional = flags._;
  if (positional.length < 1) {
    printError('Usage: nexttoken workspace rm <workspace_id>');
    return EXIT.USAGE;
  }
  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);
  await client.workspaces.delete(positional[0]);
  if (flags.json) printJSON({ id: positional[0], deleted: true });
  else printInfo(`✓ Deleted workspace ${positional[0]}`);
  return EXIT.OK;
}

async function upload(argv) {
  const flags = mri(argv, {
    boolean: ['json', 'no-browser'],
    string: ['api-key', 'api-base-url'],
  });
  validateFlags(flags, COMMON_FLAGS, 'nexttoken workspace upload');
  const positional = flags._;
  if (positional.length < 2) {
    printError('Usage: nexttoken workspace upload <local_path> <ws_id>:<remote_path>');
    return EXIT.USAGE;
  }
  const [localPath, target] = positional;
  const colonIdx = target.indexOf(':');
  if (colonIdx === -1) {
    printError("Target must be in the form '<ws_id>:<remote_path>'");
    return EXIT.USAGE;
  }
  const wsId = target.slice(0, colonIdx);
  const remotePath = target.slice(colonIdx + 1);
  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);
  const result = await client.workspaces.upload(wsId, localPath, remotePath);
  if (flags.json) printJSON(result);
  else printInfo(`✓ Uploaded ${result.bytes} bytes to ${wsId}:${result.path}`);
  return EXIT.OK;
}

async function download(argv) {
  const flags = mri(argv, {
    boolean: ['json', 'no-browser'],
    string: ['api-key', 'api-base-url'],
  });
  validateFlags(flags, COMMON_FLAGS, 'nexttoken workspace download');
  const positional = flags._;
  if (positional.length < 2) {
    printError('Usage: nexttoken workspace download <ws_id>:<remote_path> <local_path>');
    return EXIT.USAGE;
  }
  const [source, localPath] = positional;
  const colonIdx = source.indexOf(':');
  if (colonIdx === -1) {
    printError("Source must be in the form '<ws_id>:<remote_path>'");
    return EXIT.USAGE;
  }
  const wsId = source.slice(0, colonIdx);
  const remotePath = source.slice(colonIdx + 1);
  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);
  const bytes = await client.workspaces.download(wsId, remotePath, localPath);
  if (flags.json) printJSON({ workspace_id: wsId, remote_path: remotePath, local_path: localPath, bytes });
  else printInfo(`✓ Downloaded ${bytes} bytes to ${localPath}`);
  return EXIT.OK;
}

async function files(argv) {
  const flags = mri(argv, {
    boolean: ['json', 'recursive', 'no-browser'],
    string: ['path', 'api-key', 'api-base-url'],
  });
  validateFlags(flags, FILES_FLAGS, 'nexttoken workspace files');
  const positional = flags._;
  if (positional.length < 1) {
    printError('Usage: nexttoken workspace files <ws_id> [--path <p>] [--recursive]');
    return EXIT.USAGE;
  }
  const wsId = positional[0];
  const cred = await ensureCredential(flags);
  const client = await buildClient(cred);
  const items = await client.workspaces.listFiles(wsId, flags.path || '', { recursive: Boolean(flags.recursive) });
  if (flags.json) {
    printJSON(items);
  } else {
    if (items.length === 0) {
      printInfo('(empty)');
    } else {
      for (const item of items) {
        process.stdout.write(`${item.type === 'directory' ? 'd' : 'f'}\t${item.name}\n`);
      }
    }
  }
  return EXIT.OK;
}

function serializeWorkspace(ws) {
  return {
    id: ws.id,
    name: ws.name,
    created_at: ws.createdAt,
    updated_at: ws.updatedAt,
  };
}

module.exports = { run };
