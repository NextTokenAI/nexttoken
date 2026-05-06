'use strict';

const os = require('os');

const { getProfileState, setProfileState } = require('./state');
const { loadSdk } = require('./client');

/**
 * Resolve the default workspace for the active profile.
 *
 *   1. Cache hit in ~/.nexttoken/state.json (validate with workspaces.get).
 *   2. On 404 (deleted from dashboard), fall through to (3).
 *   3. List workspaces, find one named `CLI Workspace · <hostname>`, reuse it.
 *   4. None found — create one and cache.
 *
 * @param {import('@nexttoken/sdk').NextToken} client
 * @param {{apiBaseUrl: string, userEmail: string}} profile
 * @returns {Promise<import('@nexttoken/sdk').Workspace>}
 */
async function ensureDefaultWorkspace(client, profile) {
  const sdk = await loadSdk();
  const NotFoundError = sdk.NotFoundError;

  const cached = getProfileState(profile.apiBaseUrl, profile.userEmail);
  if (cached.default_workspace_id) {
    try {
      return await client.workspaces.get(cached.default_workspace_id);
    } catch (err) {
      if (err && err instanceof NotFoundError) {
        // Server-side delete; fall through.
      } else {
        throw err;
      }
    }
  }

  const name = defaultWorkspaceName();
  const all = await client.workspaces.list();
  const existing = all.find((w) => w.name === name);
  let ws;
  if (existing) {
    ws = existing;
  } else {
    ws = await client.workspaces.create(name);
  }
  setProfileState(profile.apiBaseUrl, profile.userEmail, {
    default_workspace_id: ws.id,
  });
  return ws;
}

function defaultWorkspaceName() {
  return `CLI Workspace · ${os.hostname()}`;
}

module.exports = { ensureDefaultWorkspace, defaultWorkspaceName };
