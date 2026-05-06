'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isInteractive, shouldOpenBrowser } = require('../lib/interactive');

function tty() { return { isTTY: true }; }
function pipe() { return { isTTY: false }; }

test('isInteractive: true when stdout + stderr are TTYs and CI unset', () => {
  assert.equal(isInteractive({ stdout: tty(), stderr: tty(), env: {} }), true);
});

test('isInteractive: false when --json', () => {
  assert.equal(isInteractive({ stdout: tty(), stderr: tty(), env: {}, json: true }), false);
});

test('isInteractive: false when CI=1', () => {
  assert.equal(isInteractive({ stdout: tty(), stderr: tty(), env: { CI: '1' } }), false);
});

test('isInteractive: false when stdout is not a TTY', () => {
  assert.equal(isInteractive({ stdout: pipe(), stderr: tty(), env: {} }), false);
});

test('isInteractive: false when stderr is not a TTY', () => {
  assert.equal(isInteractive({ stdout: tty(), stderr: pipe(), env: {} }), false);
});

test('isInteractive: NOT gated on stdin (piped prompts must still trigger auth)', () => {
  // We don't pass stdin into isInteractive at all. Verify a piped-stdin
  // scenario (stdout/stderr TTY, stdin non-TTY) still returns true.
  const stdin = pipe();
  void stdin;  // present for clarity; isInteractive ignores stdin
  assert.equal(isInteractive({ stdout: tty(), stderr: tty(), env: {} }), true);
});

test('isInteractive: false when NEXTTOKEN_NO_INTERACTIVE=1', () => {
  assert.equal(
    isInteractive({ stdout: tty(), stderr: tty(), env: { NEXTTOKEN_NO_INTERACTIVE: '1' } }),
    false,
  );
});

test('shouldOpenBrowser: true by default', () => {
  assert.equal(shouldOpenBrowser({ env: {} }), true);
});

test('shouldOpenBrowser: false with noBrowser flag', () => {
  assert.equal(shouldOpenBrowser({ noBrowser: true, env: {} }), false);
});

test('shouldOpenBrowser: false with NEXTTOKEN_NO_BROWSER=1', () => {
  assert.equal(shouldOpenBrowser({ env: { NEXTTOKEN_NO_BROWSER: '1' } }), false);
});
