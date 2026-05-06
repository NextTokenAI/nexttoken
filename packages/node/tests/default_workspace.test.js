'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let tmpHome;
let originalHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nexttoken-dws-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  delete require.cache[require.resolve('../lib/state')];
  delete require.cache[require.resolve('../lib/credentials')];
  delete require.cache[require.resolve('../lib/default_workspace')];
});

afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete require.cache[require.resolve('../lib/state')];
  delete require.cache[require.resolve('../lib/credentials')];
  delete require.cache[require.resolve('../lib/default_workspace')];
});

class FakeNotFoundError extends Error {
  constructor() { super('not found'); this.name = 'NotFoundError'; }
}

function makeFakeClient({ getResults = [], listResult = [], createResult }) {
  let getCallIdx = 0;
  return {
    workspaces: {
      get: async (id) => {
        const next = getResults[getCallIdx++];
        if (next instanceof Error) throw next;
        return next || { id, name: 'mock' };
      },
      list: async () => listResult,
      create: async (name) => createResult || { id: 'ws_new', name, createdAt: 'now' },
    },
  };
}

// Stub out the SDK module: lib/default_workspace dynamically imports
// '@nexttoken/sdk' to read NotFoundError. Provide our own.
function stubSdk() {
  const cachePath = require.resolve('../lib/client');
  const original = require('../lib/client');
  const { loadSdk } = original;
  void loadSdk;
  const stubbed = { ...original, loadSdk: async () => ({ NotFoundError: FakeNotFoundError }) };
  require.cache[cachePath].exports = stubbed;
}

test('cache hit: returns workspaces.get(cached_id)', async () => {
  const { setProfileState } = require('../lib/state');
  setProfileState('https://api.example.test', 'a@b.com', { default_workspace_id: 'ws_cached' });
  stubSdk();
  const { ensureDefaultWorkspace } = require('../lib/default_workspace');
  const client = makeFakeClient({ getResults: [{ id: 'ws_cached', name: 'CLI Workspace · h' }] });
  const ws = await ensureDefaultWorkspace(client, {
    apiBaseUrl: 'https://api.example.test',
    userEmail: 'a@b.com',
  });
  assert.equal(ws.id, 'ws_cached');
});

test('cache 404: falls through to lookup-by-name + reuses existing', async () => {
  const { setProfileState, getProfileState } = require('../lib/state');
  setProfileState('https://api.example.test', 'a@b.com', { default_workspace_id: 'ws_stale' });
  stubSdk();
  const { ensureDefaultWorkspace, defaultWorkspaceName } = require('../lib/default_workspace');
  const name = defaultWorkspaceName();
  const client = makeFakeClient({
    getResults: [new FakeNotFoundError()],
    listResult: [{ id: 'ws_existing', name }],
  });
  const ws = await ensureDefaultWorkspace(client, {
    apiBaseUrl: 'https://api.example.test',
    userEmail: 'a@b.com',
  });
  assert.equal(ws.id, 'ws_existing');
  // Cache should be updated.
  const state = getProfileState('https://api.example.test', 'a@b.com');
  assert.equal(state.default_workspace_id, 'ws_existing');
});

test('no cache + no match: creates a new workspace', async () => {
  stubSdk();
  const { ensureDefaultWorkspace } = require('../lib/default_workspace');
  const client = makeFakeClient({
    listResult: [{ id: 'ws_other', name: 'unrelated' }],
    createResult: { id: 'ws_brand_new', name: 'CLI Workspace · h', createdAt: 'now' },
  });
  const ws = await ensureDefaultWorkspace(client, {
    apiBaseUrl: 'https://api.example.test',
    userEmail: 'a@b.com',
  });
  assert.equal(ws.id, 'ws_brand_new');
});

test('profile-keyed: prod and staging caches don\'t collide', async () => {
  const { setProfileState } = require('../lib/state');
  setProfileState('https://api.nexttoken.co', 'a@b.com', { default_workspace_id: 'ws_prod' });
  setProfileState('https://api-staging.nexttoken.co', 'a@b.com', { default_workspace_id: 'ws_stg' });
  stubSdk();
  const { ensureDefaultWorkspace } = require('../lib/default_workspace');

  const prodClient = makeFakeClient({ getResults: [{ id: 'ws_prod', name: 'p' }] });
  const stgClient = makeFakeClient({ getResults: [{ id: 'ws_stg', name: 's' }] });

  const prodWs = await ensureDefaultWorkspace(prodClient, {
    apiBaseUrl: 'https://api.nexttoken.co',
    userEmail: 'a@b.com',
  });
  const stgWs = await ensureDefaultWorkspace(stgClient, {
    apiBaseUrl: 'https://api-staging.nexttoken.co',
    userEmail: 'a@b.com',
  });
  assert.equal(prodWs.id, 'ws_prod');
  assert.equal(stgWs.id, 'ws_stg');
});
