'use strict';

const { getActiveCredential, saveCredential } = require('./credentials');
const { isInteractive, shouldOpenBrowser } = require('./interactive');
const { EXIT } = require('./exit_codes');
const { acquireCredential } = require('./auth_flow');
const { browserAuthEnabled } = require('./feature_flags');
const { readNoFlag } = require('./flags');

const DEFAULT_API_BASE_URL = 'https://api.nexttoken.co';
const DEFAULT_WEB_BASE_URL = 'https://nexttoken.co';

/**
 * Resolve the API base URL from flags / env / default.
 */
function resolveApiBaseUrl(flags = {}) {
  if (flags['api-base-url']) return String(flags['api-base-url']);
  if (process.env.NEXTTOKEN_API_BASE_URL) return process.env.NEXTTOKEN_API_BASE_URL;
  return DEFAULT_API_BASE_URL;
}

function resolveWebBaseUrl() {
  if (process.env.NEXTTOKEN_WEB_BASE_URL) return process.env.NEXTTOKEN_WEB_BASE_URL;
  return DEFAULT_WEB_BASE_URL;
}

/**
 * Resolve credentials in this precedence:
 *   1. --api-key flag
 *   2. NEXTTOKEN_API_KEY env var
 *   3. ~/.nexttoken/credentials.json (active profile, scoped to api-base-url if set)
 *   4. Trigger interactive auth (only when interactive)
 *
 * On non-interactive contexts, throws AuthRequiredError instead of opening a browser.
 *
 * @param {Object} flags  parsed argv flags from mri
 * @returns {Promise<{ apiKey: string, apiBaseUrl: string, userEmail?: string }>}
 */
async function ensureCredential(flags = {}) {
  const apiBaseUrl = resolveApiBaseUrl(flags);

  // 1) Explicit flag wins.
  if (flags['api-key']) {
    return { apiKey: String(flags['api-key']), apiBaseUrl };
  }

  // 2) Env var.
  if (process.env.NEXTTOKEN_API_KEY) {
    return { apiKey: process.env.NEXTTOKEN_API_KEY, apiBaseUrl };
  }

  // 3) Stored credential, scoped to this base URL so staging/prod don't bleed.
  const stored = getActiveCredential({ apiBaseUrl });
  if (stored) {
    return {
      apiKey: stored.api_key,
      apiBaseUrl: stored.api_base_url,
      userEmail: stored.user_email,
    };
  }

  // 4) Interactive auth — gated by feature flag and TTY checks.
  // The browser-auth endpoints (/cli-auth, /cli-auth/exchange, …) are not
  // deployed yet; until they are, refuse to open a browser that would
  // dead-end at a missing endpoint and instead point users at the env-var
  // path. Set NEXTTOKEN_CLI_BROWSER_AUTH=1 to opt in for testing once the
  // backend ships.
  if (!browserAuthEnabled()) {
    const err = new Error(
      'Authentication required. Set NEXTTOKEN_API_KEY or pass --api-key=<value>.\n' +
        '(Browser-based auth via `nexttoken auth login` is coming soon.)',
    );
    err.exitCode = EXIT.AUTH;
    throw err;
  }

  if (!isInteractive({ json: flags.json })) {
    const err = new Error(
      'Authentication required. Set NEXTTOKEN_API_KEY or run `nexttoken auth login`.',
    );
    err.exitCode = EXIT.AUTH;
    throw err;
  }

  const noBrowser = readNoFlag(flags, 'browser');
  const openBrowser = shouldOpenBrowser({ noBrowser });
  const cred = await acquireCredential({
    apiBaseUrl,
    useBrowser: openBrowser,
  });
  saveCredential(cred);
  process.stderr.write(`✓ Signed in as ${cred.user_email} — credential saved to ~/.nexttoken/credentials.json\n`);
  return {
    apiKey: cred.api_key,
    apiBaseUrl: cred.api_base_url,
    userEmail: cred.user_email,
  };
}

module.exports = {
  DEFAULT_API_BASE_URL,
  DEFAULT_WEB_BASE_URL,
  resolveApiBaseUrl,
  resolveWebBaseUrl,
  ensureCredential,
};
