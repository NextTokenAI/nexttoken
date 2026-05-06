'use strict';

/**
 * Whether the CLI may open a browser / prompt the user.
 *
 * The gate is on stdout AND stderr being TTYs (not stdin) — piped
 * prompts (`cat p.md | nexttoken agent run`) are an explicitly supported
 * mode of interactive use, so stdin being non-TTY shouldn't disable
 * browser auth for a user sitting at a real terminal.
 *
 * @param {{ json?: boolean, env?: NodeJS.ProcessEnv, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream }} [opts]
 * @returns {boolean}
 */
function isInteractive(opts = {}) {
  const env = opts.env || process.env;
  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;
  if (opts.json) return false;
  if (env.CI && env.CI !== '0' && env.CI !== '') return false;
  if (env.NEXTTOKEN_NO_INTERACTIVE === '1') return false;
  if (!stdout.isTTY || !stderr.isTTY) return false;
  return true;
}

/**
 * Whether the loopback browser auth flow should attempt to open a browser.
 * `--no-browser` flag or NEXTTOKEN_NO_BROWSER=1 forces the device code path.
 */
function shouldOpenBrowser({ noBrowser, env = process.env } = {}) {
  if (noBrowser) return false;
  if (env.NEXTTOKEN_NO_BROWSER === '1') return false;
  return true;
}

module.exports = { isInteractive, shouldOpenBrowser };
