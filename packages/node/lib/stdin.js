'use strict';

/**
 * Read entire stdin as a UTF-8 string. Returns null if stdin is a TTY
 * (no piped input). Useful for `cat prompt.md | nexttoken agent run`.
 */
async function readStdinIfPiped() {
  if (process.stdin.isTTY) return null;
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data.trim() === '' ? null : data;
}

module.exports = { readStdinIfPiped };
