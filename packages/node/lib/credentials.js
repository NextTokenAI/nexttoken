'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME_DIR = path.join(os.homedir(), '.nexttoken');
const CREDS_PATH = path.join(HOME_DIR, 'credentials.json');

/**
 * @typedef {Object} Credential
 * @property {string} api_key
 * @property {string} api_base_url
 * @property {string} user_email
 * @property {string} [tag]
 * @property {string} [issued_at]
 */

/**
 * @typedef {Object} CredentialsFile
 * @property {Object<string, Credential>} profiles
 * @property {string} [current]
 */

/**
 * Profile key shape: `<api_base_url>::<user_email>`. Used as the canonical
 * identity so staging/prod and account switches never collide.
 */
function profileKey(apiBaseUrl, userEmail) {
  return `${apiBaseUrl}::${userEmail}`;
}

function ensureHomeDir() {
  fs.mkdirSync(HOME_DIR, { recursive: true });
}

function isPosix() {
  return process.platform !== 'win32';
}

/** @returns {CredentialsFile} */
function readCredsFile() {
  if (!fs.existsSync(CREDS_PATH)) return { profiles: {} };
  // POSIX: refuse to read if perms are broader than 0600.
  if (isPosix()) {
    const stat = fs.statSync(CREDS_PATH);
    const mode = stat.mode & 0o777;
    if (mode & 0o077) {
      throw new Error(
        `Credentials file ${CREDS_PATH} has broader permissions than 0600 (current: ${mode.toString(8).padStart(4, '0')}). ` +
        `Run: chmod 600 ${CREDS_PATH}`,
      );
    }
  }
  const raw = fs.readFileSync(CREDS_PATH, 'utf8');
  if (!raw.trim()) return { profiles: {} };
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.profiles) {
    return { profiles: {} };
  }
  return parsed;
}

function writeCredsFile(file) {
  ensureHomeDir();
  const tmp = `${CREDS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, CREDS_PATH);
  // Best-effort chmod on every platform; on Windows this is largely a no-op
  // and we don't enforce ACLs (no portable Node API).
  try { fs.chmodSync(CREDS_PATH, 0o600); } catch (_) { /* best-effort */ }
}

/**
 * Resolve the active credential.
 *
 * Note: this intentionally does NOT swallow errors from readCredsFile().
 * If the credentials file exists but has unsafe permissions or is corrupt,
 * the caller deserves the loud failure (with the chmod repair instruction)
 * rather than silently fall through to "no credentials → trigger auth flow"
 * — which would mask a security-relevant condition. Missing-file is already
 * handled by readCredsFile returning `{profiles:{}}`, so any error here is
 * a real problem worth surfacing.
 *
 * @param {Object} [opts]
 * @param {string} [opts.apiBaseUrl]   restrict to this base URL
 * @param {string} [opts.userEmail]    restrict to this email
 * @returns {Credential | null}
 */
function getActiveCredential(opts = {}) {
  const file = readCredsFile();

  // If a specific (baseUrl, email) pair is requested, prefer that.
  if (opts.apiBaseUrl && opts.userEmail) {
    const key = profileKey(opts.apiBaseUrl, opts.userEmail);
    return file.profiles[key] || null;
  }

  // If only baseUrl is given, prefer current if it matches, else first match.
  if (opts.apiBaseUrl) {
    if (file.current && file.profiles[file.current] &&
        file.profiles[file.current].api_base_url === opts.apiBaseUrl) {
      return file.profiles[file.current];
    }
    for (const profile of Object.values(file.profiles)) {
      if (profile.api_base_url === opts.apiBaseUrl) return profile;
    }
    return null;
  }

  if (file.current && file.profiles[file.current]) {
    return file.profiles[file.current];
  }
  // No "current" set — fall back to the only profile if there is one.
  const keys = Object.keys(file.profiles);
  if (keys.length === 1) return file.profiles[keys[0]];
  return null;
}

/**
 * Save a credential to the named profile, set it as current.
 * @param {Credential} cred
 */
function saveCredential(cred) {
  if (!cred || !cred.api_key || !cred.api_base_url || !cred.user_email) {
    throw new Error('saveCredential: api_key, api_base_url, user_email required');
  }
  const file = (() => { try { return readCredsFile(); } catch { return { profiles: {} }; } })();
  const key = profileKey(cred.api_base_url, cred.user_email);
  file.profiles[key] = {
    api_key: cred.api_key,
    api_base_url: cred.api_base_url,
    user_email: cred.user_email,
    tag: cred.tag,
    issued_at: cred.issued_at || new Date().toISOString(),
  };
  file.current = key;
  writeCredsFile(file);
  return file.profiles[key];
}

/**
 * Remove the active profile (or all profiles if `all=true`). Updates `current`.
 */
function removeCredential({ all = false } = {}) {
  let file;
  try { file = readCredsFile(); } catch { return; }
  if (all) {
    writeCredsFile({ profiles: {} });
    return;
  }
  if (!file.current) return;
  delete file.profiles[file.current];
  const remaining = Object.keys(file.profiles);
  file.current = remaining.length === 1 ? remaining[0] : undefined;
  writeCredsFile(file);
}

module.exports = {
  CREDS_PATH,
  HOME_DIR,
  profileKey,
  readCredsFile,
  writeCredsFile,
  getActiveCredential,
  saveCredential,
  removeCredential,
};
