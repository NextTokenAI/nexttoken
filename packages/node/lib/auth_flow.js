'use strict';

/**
 * Unified poll-based browser auth flow.
 *
 * The CLI calls /cli-auth/start, gets back (session_code, user_code,
 * authorize_url), tries to open the user's default browser at
 * authorize_url, prints both the URL and user_code so the same flow
 * works on headless boxes / SSH / Codespaces, and polls /cli-auth/poll
 * until the user authorizes or the session expires.
 *
 * The API key is delivered by the polling response — never via a URL
 * or a localhost listener. This unifies what was previously a
 * "loopback OAuth + device-code fallback" pair into a single code path,
 * using auto-open as a UX nicety on top.
 */

const os = require('os');
const { spawn } = require('child_process');

const { version: VERSION } = require('../package.json');

const TOTAL_DEADLINE_MS = 15 * 60 * 1000;  // 15 minutes — matches server-side TTL

/**
 * Acquire a credential through the browser flow.
 *
 * @param {Object} opts
 * @param {string} opts.apiBaseUrl   API base URL (used for /cli-auth/* and as the credential's base)
 * @param {boolean} [opts.useBrowser]  Whether to attempt to auto-open the browser. Default true.
 * @param {typeof fetch} [opts.fetchImpl]  Custom fetch (tests).
 * @returns {Promise<{api_key, user_email, tag, api_base_url}>}
 */
async function acquireCredential(opts) {
  const cred = await pollingAuthFlow(opts);
  return { ...cred, api_base_url: opts.apiBaseUrl };
}

/**
 * Single-flow implementation: start → optionally open browser → poll until done.
 */
async function pollingAuthFlow({ apiBaseUrl, useBrowser = true, fetchImpl }) {
  const fetcher = fetchImpl || fetch;

  // 1) Start a session.
  const startRes = await fetcher(`${apiBaseUrl}/cli-auth/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostname: os.hostname(),
      cli_version: VERSION,
    }),
  });
  if (!startRes.ok) {
    const text = await safeText(startRes);
    throw new Error(`Auth start failed: HTTP ${startRes.status}: ${text}`);
  }
  const start = await startRes.json();
  if (!start || !start.session_code || !start.user_code || !start.authorize_url) {
    throw new Error('Auth start returned an invalid payload');
  }

  const intervalMs = Math.max(1, start.interval || 2) * 1000;
  const expiresInMs = Math.max(0, (start.expires_in || 900) * 1000);
  const deadline = Date.now() + Math.min(expiresInMs, TOTAL_DEADLINE_MS);

  // 2) Print the URL + code, optionally auto-open the browser.
  process.stderr.write(
    `→ To authorize this CLI, visit:\n   ${start.authorize_url}\n` +
      `   and enter code: ${start.user_code}\n`,
  );
  if (useBrowser) {
    openBrowser(start.authorize_url);
    process.stderr.write('   (We tried to open your browser automatically.)\n');
  }
  process.stderr.write(`→ Waiting for authorization (up to ${Math.round(expiresInMs / 60000)} minutes)…\n`);

  // 3) Poll until success / explicit denial / expiry / wall-clock timeout.
  let backoffMs = intervalMs;
  while (Date.now() < deadline) {
    await sleep(backoffMs);
    const pollRes = await fetcher(`${apiBaseUrl}/cli-auth/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_code: start.session_code }),
    });
    if (pollRes.status === 200) {
      const data = await pollRes.json();
      if (!data || !data.api_key || !data.user_email) {
        throw new Error('Auth poll returned an invalid payload');
      }
      return data;
    }
    if (pollRes.status === 202) {
      backoffMs = intervalMs;
      continue;
    }
    if (pollRes.status === 429) {
      backoffMs += 1000;  // honor slow_down
      continue;
    }
    if (pollRes.status === 410) {
      const text = await safeText(pollRes);
      throw new Error(
        text && /access_denied/i.test(text)
          ? 'Authorization was denied in the browser.'
          : 'Authorization session expired before authorization completed.',
      );
    }
    const text = await safeText(pollRes);
    throw new Error(`Auth poll failed: HTTP ${pollRes.status}: ${text}`);
  }
  throw new Error('Authorization session expired before authorization completed.');
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* best-effort — the printed URL is the primary instruction */
    });
    child.unref();
  } catch (_err) {
    // best-effort
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '(no body)';
  }
}

module.exports = {
  acquireCredential,
  pollingAuthFlow,
  __internals: { openBrowser },
};
