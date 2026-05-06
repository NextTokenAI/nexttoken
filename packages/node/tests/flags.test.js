'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mri = require('mri');

const { validateFlags, readNoFlag } = require('../lib/flags');
const { EXIT } = require('../lib/exit_codes');

test('validateFlags: passes when all flags are allowed', () => {
  const flags = { _: ['hello'], 'workspace': 'ws_1', 'json': true };
  validateFlags(flags, ['_', 'workspace', 'json'], 'cmd');
});

test('validateFlags: throws with exitCode 2 on unknown flag', () => {
  const flags = { _: [], 'workspacce': 'ws_1' };  // typo
  assert.throws(
    () => validateFlags(flags, ['_', 'workspace'], 'nexttoken agent run'),
    (err) => {
      assert.equal(err.exitCode, EXIT.USAGE);
      assert.match(err.message, /Unknown flag: --workspacce/);
      assert.match(err.message, /nexttoken agent run/);
      return true;
    },
  );
});

test('validateFlags: positional `_` is always allowed', () => {
  validateFlags({ _: ['a', 'b', 'c'] }, ['_'], 'cmd');
});

test('validateFlags: catches extra unknown flag among multiple', () => {
  const flags = { _: [], 'json': true, 'verbose': true };
  assert.throws(
    () => validateFlags(flags, ['_', 'json'], 'cmd'),
    /Unknown flag: --verbose/,
  );
});

// ---------- readNoFlag: handles mri's auto-negation ----------
//
// mri parses `--no-X` as `flags.X = false`, NOT `flags['no-X'] = true`. The
// previous code read `flags['no-X']` directly and silently ignored the
// negation. These tests use REAL mri parsing (not hand-built objects) so the
// fix is locked against the actual library behavior, not just our mental
// model of it.

test('readNoFlag: --no-stream argv → returns true', () => {
  const flags = mri(['--no-stream'], { boolean: ['no-stream', 'stream'] });
  assert.equal(readNoFlag(flags, 'stream'), true);
});

test('readNoFlag: --no-browser argv → returns true', () => {
  const flags = mri(['--no-browser'], { boolean: ['no-browser', 'browser'] });
  assert.equal(readNoFlag(flags, 'browser'), true);
});

test('readNoFlag: omitted → returns false', () => {
  const flags = mri([], { boolean: ['no-stream', 'stream'] });
  assert.equal(readNoFlag(flags, 'stream'), false);
});

test('readNoFlag: --stream (positive) → returns false', () => {
  const flags = mri(['--stream'], { boolean: ['no-stream', 'stream'] });
  assert.equal(readNoFlag(flags, 'stream'), false);
});

test('readNoFlag: explicit --no-stream=true → returns true', () => {
  const flags = mri(['--no-stream'], { boolean: ['no-stream', 'stream'] });
  // Some shells / argv shapes set the literal "no-X" key. Verify we still catch it.
  flags['no-stream'] = true;
  assert.equal(readNoFlag(flags, 'stream'), true);
});
