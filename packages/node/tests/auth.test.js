'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let tmpHome;
let originalHome;
let originalEnv;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttoken-auth-'));
  originalHome = process.env.HOME;
  originalEnv = { ...process.env };
  process.env.HOME = tmpHome;
  delete process.env.NEXTTOKEN_API_KEY;
  delete process.env.NEXTTOKEN_API_BASE_URL;
  delete process.env.CI;
  delete require.cache[require.resolve('../lib/auth')];
  delete require.cache[require.resolve('../lib/credentials')];
  delete require.cache[require.resolve('../lib/auth_flow')];
});

afterEach(() => {
  process.env.HOME = originalHome;
  for (const k of Object.keys(process.env)) {
    if (!(k in originalEnv)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(originalEnv)) process.env[k] = v;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete require.cache[require.resolve('../lib/auth')];
  delete require.cache[require.resolve('../lib/credentials')];
  delete require.cache[require.resolve('../lib/auth_flow')];
});

test('--api-key flag wins over env and file', async () => {
  process.env.NEXTTOKEN_API_KEY = 'env-key';
  const { saveCredential } = require('../lib/credentials');
  saveCredential({
    api_key: 'file-key',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
  });
  const { ensureCredential } = require('../lib/auth');
  const cred = await ensureCredential({ 'api-key': 'flag-key' });
  assert.equal(cred.apiKey, 'flag-key');
  assert.equal(cred.apiBaseUrl, 'https://api.nexttoken.co');
});

test('NEXTTOKEN_API_KEY env wins over file', async () => {
  process.env.NEXTTOKEN_API_KEY = 'env-key';
  const { saveCredential } = require('../lib/credentials');
  saveCredential({
    api_key: 'file-key',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
  });
  const { ensureCredential } = require('../lib/auth');
  const cred = await ensureCredential({});
  assert.equal(cred.apiKey, 'env-key');
});

test('falls back to credentials.json when no flag/env', async () => {
  const { saveCredential } = require('../lib/credentials');
  saveCredential({
    api_key: 'file-key',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
  });
  const { ensureCredential } = require('../lib/auth');
  const cred = await ensureCredential({});
  assert.equal(cred.apiKey, 'file-key');
  assert.equal(cred.userEmail, 'a@b.com');
});

test('non-interactive context with no creds throws AuthRequired (exit 3)', async () => {
  process.env.CI = '1';   // force non-interactive
  const { ensureCredential } = require('../lib/auth');
  await assert.rejects(
    () => ensureCredential({}),
    (err) => {
      assert.equal(err.exitCode, 3);
      assert.match(err.message, /Authentication required/);
      return true;
    },
  );
});

test('browser auth opt-out: NEXTTOKEN_CLI_BROWSER_AUTH=0 falls back to API-key hint', async () => {
  // The default is now ON, but adopters pointed at a backend without
  // the /cli-auth endpoints can opt out via the env-var off-switch.
  process.env.NEXTTOKEN_CLI_BROWSER_AUTH = '0';
  const { ensureCredential } = require('../lib/auth');
  await assert.rejects(
    () => ensureCredential({}),
    (err) => {
      assert.equal(err.exitCode, 3);
      assert.match(err.message, /Set NEXTTOKEN_API_KEY/);
      return true;
    },
  );
});

test('browser auth on (default) + non-interactive ctx: hits the interactive-only gate', async () => {
  // Default-on. With CI=1 (non-interactive), the second gate catches and
  // refuses to open a browser, exiting 3 with the canonical message.
  process.env.CI = '1';
  const { ensureCredential } = require('../lib/auth');
  await assert.rejects(
    () => ensureCredential({}),
    (err) => {
      assert.equal(err.exitCode, 3);
      assert.match(err.message, /Authentication required/);
      return true;
    },
  );
});

test('--api-base-url flag overrides env', async () => {
  process.env.NEXTTOKEN_API_BASE_URL = 'https://from-env.example.com';
  process.env.NEXTTOKEN_API_KEY = 'k';
  const { ensureCredential, resolveApiBaseUrl } = require('../lib/auth');
  assert.equal(resolveApiBaseUrl({ 'api-base-url': 'https://from-flag.example.com' }),
    'https://from-flag.example.com');
  const cred = await ensureCredential({ 'api-base-url': 'https://from-flag.example.com' });
  assert.equal(cred.apiBaseUrl, 'https://from-flag.example.com');
});
