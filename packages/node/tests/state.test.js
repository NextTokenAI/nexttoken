'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let tmpHome;
let originalHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttoken-state-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  delete require.cache[require.resolve('../lib/state')];
  delete require.cache[require.resolve('../lib/credentials')];
});

afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete require.cache[require.resolve('../lib/state')];
  delete require.cache[require.resolve('../lib/credentials')];
});

test('state is profile-keyed by api_base_url::user_email', () => {
  const { setProfileState, getProfileState, STATE_PATH } = require('../lib/state');
  setProfileState('https://api.nexttoken.co', 'a@b.com', { default_workspace_id: 'ws_prod' });
  setProfileState('https://api-staging.nexttoken.co', 'a@b.com', { default_workspace_id: 'ws_stg' });

  const prod = getProfileState('https://api.nexttoken.co', 'a@b.com');
  const stg = getProfileState('https://api-staging.nexttoken.co', 'a@b.com');
  assert.equal(prod.default_workspace_id, 'ws_prod');
  assert.equal(stg.default_workspace_id, 'ws_stg');

  const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  assert.deepEqual(Object.keys(raw.profiles).sort(), [
    'https://api-staging.nexttoken.co::a@b.com',
    'https://api.nexttoken.co::a@b.com',
  ]);
});

test('getProfileState returns {} for unknown profile', () => {
  const { getProfileState } = require('../lib/state');
  assert.deepEqual(getProfileState('https://api.nexttoken.co', 'unknown@x.com'), {});
});

test('setProfileState patches existing slot rather than overwriting', () => {
  const { setProfileState, getProfileState } = require('../lib/state');
  setProfileState('https://api.nexttoken.co', 'a@b.com', { default_workspace_id: 'ws_1', extra: 'a' });
  setProfileState('https://api.nexttoken.co', 'a@b.com', { default_workspace_id: 'ws_2' });
  const out = getProfileState('https://api.nexttoken.co', 'a@b.com');
  assert.equal(out.default_workspace_id, 'ws_2');
  assert.equal(out.extra, 'a');
});

test('clearProfileState removes only the named profile', () => {
  const { setProfileState, clearProfileState, readStateFile } = require('../lib/state');
  setProfileState('https://api.nexttoken.co', 'a@b.com', { default_workspace_id: 'ws_1' });
  setProfileState('https://api-staging.nexttoken.co', 'a@b.com', { default_workspace_id: 'ws_2' });
  clearProfileState('https://api.nexttoken.co', 'a@b.com');
  const file = readStateFile();
  assert.deepEqual(Object.keys(file.profiles), ['https://api-staging.nexttoken.co::a@b.com']);
});

test('readStateFile tolerates a corrupt or empty file', () => {
  const { STATE_PATH, readStateFile } = require('../lib/state');
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, '{ this is not json');
  assert.deepEqual(readStateFile(), { profiles: {} });
});
