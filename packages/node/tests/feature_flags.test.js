'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { browserAuthEnabled } = require('../lib/feature_flags');

test('browserAuthEnabled: true by default (env unset)', () => {
  assert.equal(browserAuthEnabled({}), true);
});

test('browserAuthEnabled: NEXTTOKEN_CLI_BROWSER_AUTH=0 disables', () => {
  assert.equal(browserAuthEnabled({ NEXTTOKEN_CLI_BROWSER_AUTH: '0' }), false);
});

test('browserAuthEnabled: any other value (incl. empty) keeps default ON', () => {
  assert.equal(browserAuthEnabled({ NEXTTOKEN_CLI_BROWSER_AUTH: '1' }), true);
  assert.equal(browserAuthEnabled({ NEXTTOKEN_CLI_BROWSER_AUTH: 'true' }), true);
  assert.equal(browserAuthEnabled({ NEXTTOKEN_CLI_BROWSER_AUTH: '' }), true);
  assert.equal(browserAuthEnabled({ SOMETHING_ELSE: '1' }), true);
});
