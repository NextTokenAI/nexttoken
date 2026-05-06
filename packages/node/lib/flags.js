'use strict';

const { EXIT } = require('./exit_codes');

/**
 * Validate that no unknown flags are present in `flags` (the parsed mri output).
 * Throws a usage error (exitCode = 2) on the first unknown flag.
 *
 * mri puts every observed flag into the parsed object regardless of whether it
 * was declared, so a typo like `--workspacce` silently becomes `flags.workspacce`
 * and the real `--workspace` is undefined. Without this check the CLI would
 * happily fall back to the default workspace and run user work in the wrong place.
 *
 * @param {Record<string, unknown>} flags     mri parse output (includes `_`)
 * @param {string[]} allowed                  flag names + aliases that this command accepts
 * @param {string} [contextLabel]             included in the error message ("nexttoken agent run")
 */
function validateFlags(flags, allowed, contextLabel = 'this command') {
  const knownSet = new Set(allowed);
  for (const key of Object.keys(flags)) {
    if (key === '_') continue;
    if (knownSet.has(key)) continue;
    const err = new Error(`Unknown flag: --${key} (for ${contextLabel})`);
    err.exitCode = EXIT.USAGE;
    throw err;
  }
}

/**
 * Read a `--no-X` flag from mri output, normalizing for mri's auto-negation.
 *
 * mri parses `--no-stream` as `flags.stream === false`, NOT `flags['no-stream'] === true`.
 * Reading `flags['no-stream']` directly returns `undefined` and the flag is silently
 * ignored. Always go through this helper for negated flags so both forms work:
 *   --no-stream        →  flags.stream = false                → returns true
 *   --no-stream=true   →  flags['no-stream'] = true           → returns true
 *   (omitted)          →  flags.stream = undefined            → returns false
 *   --stream           →  flags.stream = true                 → returns false
 *
 * @param {Record<string, unknown>} flags  parsed mri output
 * @param {string} negatedName             the flag name without the "no-" prefix (e.g. "stream", "browser")
 * @returns {boolean}                      whether the user requested the negated form
 */
function readNoFlag(flags, negatedName) {
  if (flags[`no-${negatedName}`] === true) return true;
  if (flags[negatedName] === false) return true;
  return false;
}

module.exports = { validateFlags, readNoFlag };
