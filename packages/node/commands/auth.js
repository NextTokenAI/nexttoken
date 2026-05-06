'use strict';

const mri = require('mri');

const { resolveApiBaseUrl } = require('../lib/auth');
const { acquireCredential } = require('../lib/auth_flow');
const { saveCredential, removeCredential, getActiveCredential } = require('../lib/credentials');
const { isInteractive, shouldOpenBrowser } = require('../lib/interactive');
const { EXIT } = require('../lib/exit_codes');
const { printJSON, printInfo, printError } = require('../lib/format');
const { validateFlags, readNoFlag } = require('../lib/flags');
const { browserAuthEnabled } = require('../lib/feature_flags');

// mri auto-negates `--no-browser` to `browser: false`; allow both keys.
const LOGIN_FLAGS = ['_', 'no-browser', 'browser', 'json', 'api-base-url'];
const LOGOUT_FLAGS = ['_', 'all'];
const WHOAMI_FLAGS = ['_', 'json', 'api-key', 'api-base-url'];

const HELP = `
Usage:
  nexttoken auth login [--no-browser] [--api-base-url <url>]
  nexttoken auth logout [--all]
  nexttoken auth whoami [--json]
`.trim();

async function run(argv) {
  const [sub, ...rest] = argv;
  if (!sub || sub === '-h' || sub === '--help') {
    process.stdout.write(HELP + '\n');
    return EXIT.OK;
  }
  if (sub === 'login') return await login(rest);
  if (sub === 'logout') return await logout(rest);
  if (sub === 'whoami') return await whoami(rest);
  printError(`Unknown subcommand: nexttoken auth ${sub}`);
  process.stderr.write(HELP + '\n');
  return EXIT.USAGE;
}

async function login(argv) {
  const flags = mri(argv, {
    boolean: ['no-browser', 'json'],
    string: ['api-base-url'],
  });
  validateFlags(flags, LOGIN_FLAGS, 'nexttoken auth login');

  if (!browserAuthEnabled()) {
    printError(
      'Browser-based auth is not yet available for this NextToken environment.\n' +
        'Use `--api-key=<value>` or set NEXTTOKEN_API_KEY in your shell.\n' +
        '(To opt in once the backend ships, set NEXTTOKEN_CLI_BROWSER_AUTH=1.)',
    );
    return EXIT.AUTH;
  }

  const apiBaseUrl = resolveApiBaseUrl(flags);

  if (!isInteractive({ json: flags.json })) {
    printError('Authentication required. Set NEXTTOKEN_API_KEY or run `nexttoken auth login` from an interactive terminal.');
    return EXIT.AUTH;
  }

  const useBrowser = shouldOpenBrowser({ noBrowser: readNoFlag(flags, 'browser') });
  const cred = await acquireCredential({ apiBaseUrl, useBrowser });
  saveCredential(cred);
  printInfo(`✓ Signed in as ${cred.user_email} — credential saved to ~/.nexttoken/credentials.json`);
  return EXIT.OK;
}

async function logout(argv) {
  const flags = mri(argv, { boolean: ['all'] });
  validateFlags(flags, LOGOUT_FLAGS, 'nexttoken auth logout');
  removeCredential({ all: Boolean(flags.all) });
  if (flags.all) {
    printInfo('✓ All credentials removed.');
  } else {
    printInfo('✓ Active credential removed.');
  }
  return EXIT.OK;
}

async function whoami(argv) {
  const flags = mri(argv, {
    boolean: ['json'],
    string: ['api-base-url', 'api-key'],
  });
  validateFlags(flags, WHOAMI_FLAGS, 'nexttoken auth whoami');
  // whoami should NOT trigger interactive auth — that would be surprising.
  if (flags['api-key'] || process.env.NEXTTOKEN_API_KEY) {
    const apiBaseUrl = resolveApiBaseUrl(flags);
    const out = {
      source: flags['api-key'] ? 'flag' : 'env',
      api_base_url: apiBaseUrl,
      user_email: '(unknown — env/flag credential)',
      tag: null,
    };
    if (flags.json) printJSON(out);
    else process.stdout.write(`source=${out.source} api_base_url=${out.api_base_url} user=(unknown)\n`);
    return EXIT.OK;
  }
  const apiBaseUrl = resolveApiBaseUrl(flags);
  const cred = getActiveCredential({ apiBaseUrl });
  if (!cred) {
    if (flags.json) {
      printJSON({ signed_in: false });
    } else {
      printError('Not signed in. Run `nexttoken auth login` to authenticate.');
    }
    return EXIT.AUTH;
  }
  const out = {
    signed_in: true,
    source: 'credentials.json',
    api_base_url: cred.api_base_url,
    user_email: cred.user_email,
    tag: cred.tag,
    issued_at: cred.issued_at,
  };
  if (flags.json) {
    printJSON(out);
  } else {
    process.stdout.write(`✓ Signed in as ${cred.user_email}\n`);
    process.stdout.write(`  api_base_url: ${cred.api_base_url}\n`);
    if (cred.tag) process.stdout.write(`  tag: ${cred.tag}\n`);
  }
  return EXIT.OK;
}

module.exports = { run };
