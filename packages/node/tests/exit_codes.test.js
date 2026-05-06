'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  EXIT,
  exitCodeForError,
  exitCodeForRunStatus,
} = require('../lib/exit_codes');

test('exitCodeForError maps SDK error names', () => {
  const mk = (name, extras = {}) => Object.assign(new Error('x'), { name, ...extras });
  assert.equal(exitCodeForError(mk('AuthError')), EXIT.AUTH);
  assert.equal(exitCodeForError(mk('BadRequestError')), EXIT.USAGE);
  assert.equal(exitCodeForError(mk('TimeoutError')), EXIT.AGENT_FAILURE);
  assert.equal(exitCodeForError(mk('RunCapExceededError')), EXIT.AGENT_FAILURE);
  assert.equal(exitCodeForError(mk('ServerError')), EXIT.NETWORK);
  assert.equal(exitCodeForError(mk('NotFoundError')), EXIT.GENERAL);
  assert.equal(exitCodeForError(mk('SomethingElse')), EXIT.GENERAL);
});

test('exitCodeForError maps node network error codes to NETWORK', () => {
  const mk = (code) => Object.assign(new Error('x'), { name: 'TypeError', code });
  assert.equal(exitCodeForError(mk('ECONNREFUSED')), EXIT.NETWORK);
  assert.equal(exitCodeForError(mk('ENOTFOUND')), EXIT.NETWORK);
  assert.equal(exitCodeForError(mk('ETIMEDOUT')), EXIT.NETWORK);
  assert.equal(exitCodeForError(mk('EAI_AGAIN')), EXIT.NETWORK);
});

test('exitCodeForError maps "fetch failed" TypeError to NETWORK', () => {
  const err = new TypeError('fetch failed');
  assert.equal(exitCodeForError(err), EXIT.NETWORK);
});

test('exitCodeForError handles null/undefined', () => {
  assert.equal(exitCodeForError(null), EXIT.GENERAL);
  assert.equal(exitCodeForError(undefined), EXIT.GENERAL);
});

test('exitCodeForRunStatus maps terminal statuses', () => {
  assert.equal(exitCodeForRunStatus('completed'), EXIT.OK);
  assert.equal(exitCodeForRunStatus('failed'), EXIT.AGENT_FAILURE);
  assert.equal(exitCodeForRunStatus('timeout'), EXIT.AGENT_FAILURE);
  assert.equal(exitCodeForRunStatus('cancelled'), EXIT.AGENT_FAILURE);
  assert.equal(exitCodeForRunStatus('running'), EXIT.GENERAL);
  assert.equal(exitCodeForRunStatus('pending'), EXIT.GENERAL);
});
