'use strict';

const fs = require('fs');
const path = require('path');
const { HOME_DIR, profileKey } = require('./credentials');

const STATE_PATH = path.join(HOME_DIR, 'state.json');

function readStateFile() {
  if (!fs.existsSync(STATE_PATH)) return { profiles: {} };
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    if (!raw.trim()) return { profiles: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.profiles) {
      return { profiles: {} };
    }
    return parsed;
  } catch (_err) {
    // Corrupt file: ignore; the CLI will repopulate as needed.
    return { profiles: {} };
  }
}

function writeStateFile(file) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { mode: 0o644 });
  fs.renameSync(tmp, STATE_PATH);
}

function getProfileState(apiBaseUrl, userEmail) {
  const file = readStateFile();
  return file.profiles[profileKey(apiBaseUrl, userEmail)] || {};
}

function setProfileState(apiBaseUrl, userEmail, patch) {
  const file = readStateFile();
  const key = profileKey(apiBaseUrl, userEmail);
  file.profiles[key] = { ...(file.profiles[key] || {}), ...patch };
  writeStateFile(file);
}

function clearProfileState(apiBaseUrl, userEmail) {
  const file = readStateFile();
  delete file.profiles[profileKey(apiBaseUrl, userEmail)];
  writeStateFile(file);
}

module.exports = {
  STATE_PATH,
  readStateFile,
  writeStateFile,
  getProfileState,
  setProfileState,
  clearProfileState,
};
