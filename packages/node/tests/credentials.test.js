'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox HOME so we don't touch the real ~/.nexttoken — set BEFORE require.
let tmpHome;
let originalHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttoken-creds-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  // Clear require cache so credentials.js picks up the new HOME.
  delete require.cache[require.resolve('../lib/credentials')];
});

afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete require.cache[require.resolve('../lib/credentials')];
});

test('saveCredential writes profile-keyed schema with chmod 0600', () => {
  const { saveCredential, CREDS_PATH, readCredsFile } = require('../lib/credentials');
  saveCredential({
    api_key: 'nt_abc',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
    tag: 'CLI · host · 2026-05-06',
  });
  assert.ok(fs.existsSync(CREDS_PATH));
  if (process.platform !== 'win32') {
    const stat = fs.statSync(CREDS_PATH);
    assert.equal(stat.mode & 0o777, 0o600);
  }
  const file = readCredsFile();
  const expectedKey = 'https://api.nexttoken.co::a@b.com';
  assert.ok(file.profiles[expectedKey], 'profile keyed by base_url::email');
  assert.equal(file.current, expectedKey);
});

test('saveCredential supports multiple profiles, current points at latest', () => {
  const { saveCredential, readCredsFile } = require('../lib/credentials');
  saveCredential({
    api_key: 'nt_prod',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
  });
  saveCredential({
    api_key: 'nt_staging',
    api_base_url: 'https://api-staging.nexttoken.co',
    user_email: 'a@b.com',
  });
  const file = readCredsFile();
  assert.equal(Object.keys(file.profiles).length, 2);
  assert.equal(file.current, 'https://api-staging.nexttoken.co::a@b.com');
});

test('getActiveCredential restricts to a given apiBaseUrl', () => {
  const { saveCredential, getActiveCredential } = require('../lib/credentials');
  saveCredential({
    api_key: 'nt_prod',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
  });
  saveCredential({
    api_key: 'nt_staging',
    api_base_url: 'https://api-staging.nexttoken.co',
    user_email: 'a@b.com',
  });
  // current is now staging (last saved), but explicit base_url filter should
  // still return the prod key when prod is requested.
  const prod = getActiveCredential({ apiBaseUrl: 'https://api.nexttoken.co' });
  assert.equal(prod.api_key, 'nt_prod');
});

test('getActiveCredential returns null when no profile matches', () => {
  const { getActiveCredential } = require('../lib/credentials');
  assert.equal(getActiveCredential(), null);
});

test('readCredsFile refuses broader-than-0600 perms on POSIX', { skip: process.platform === 'win32' }, () => {
  const { saveCredential, CREDS_PATH, readCredsFile } = require('../lib/credentials');
  saveCredential({
    api_key: 'nt_abc',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
  });
  fs.chmodSync(CREDS_PATH, 0o644);  // intentionally broader
  assert.throws(() => readCredsFile(), /broader permissions than 0600/);
});

test('getActiveCredential propagates broader-perms error (does NOT silently return null)', { skip: process.platform === 'win32' }, () => {
  const { saveCredential, getActiveCredential, CREDS_PATH } = require('../lib/credentials');
  saveCredential({
    api_key: 'nt_abc',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
  });
  fs.chmodSync(CREDS_PATH, 0o644);
  // Critical: the previous implementation caught this and returned null,
  // which would silently fall back to "no credentials → trigger auth flow"
  // and mask the security-relevant condition.
  assert.throws(
    () => getActiveCredential({ apiBaseUrl: 'https://api.nexttoken.co' }),
    /broader permissions/,
  );
});

test('getActiveCredential returns null when file simply does not exist', () => {
  const { getActiveCredential } = require('../lib/credentials');
  assert.equal(getActiveCredential({ apiBaseUrl: 'https://api.nexttoken.co' }), null);
});

test('removeCredential deletes the active profile and updates current', () => {
  const { saveCredential, removeCredential, readCredsFile } = require('../lib/credentials');
  saveCredential({
    api_key: 'nt_prod',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
  });
  saveCredential({
    api_key: 'nt_staging',
    api_base_url: 'https://api-staging.nexttoken.co',
    user_email: 'a@b.com',
  });
  // current = staging
  removeCredential();
  const file = readCredsFile();
  assert.equal(Object.keys(file.profiles).length, 1);
  assert.equal(file.current, 'https://api.nexttoken.co::a@b.com');
});

test('removeCredential({all:true}) clears every profile', () => {
  const { saveCredential, removeCredential, readCredsFile } = require('../lib/credentials');
  saveCredential({
    api_key: 'nt_prod',
    api_base_url: 'https://api.nexttoken.co',
    user_email: 'a@b.com',
  });
  removeCredential({ all: true });
  const file = readCredsFile();
  assert.deepEqual(file.profiles, {});
  assert.equal(file.current, undefined);
});
