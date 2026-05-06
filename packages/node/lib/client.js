'use strict';

let cachedSdk = null;

/**
 * Lazy-load @nexttoken/sdk. Loaded only when a command actually needs it,
 * which keeps cold start fast for `--version`, `--help`, `auth logout`.
 */
async function loadSdk() {
  if (cachedSdk) return cachedSdk;
  cachedSdk = await import('@nexttoken/sdk');
  return cachedSdk;
}

/**
 * Build a NextToken SDK client from a resolved credential.
 * @param {{apiKey: string, apiBaseUrl: string}} cred
 */
async function buildClient(cred) {
  const sdk = await loadSdk();
  return new sdk.NextToken({ apiKey: cred.apiKey, baseUrl: cred.apiBaseUrl });
}

module.exports = { loadSdk, buildClient };
