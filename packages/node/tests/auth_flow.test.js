'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { pollingAuthFlow } = require('../lib/auth_flow');

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetchOnce(seq) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (i >= seq.length) throw new Error(`unexpected fetch call: ${url}`);
    const next = seq[i++];
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  fn.calls = calls;
  return fn;
}

// Suppress "Visit / Waiting for authorization" stderr output during tests.
function withSilencedStderr(fn) {
  return async (...args) => {
    const orig = process.stderr.write;
    process.stderr.write = () => true;
    try {
      return await fn(...args);
    } finally {
      process.stderr.write = orig;
    }
  };
}

test('polling: start → poll once → 200 returns the API key', withSilencedStderr(async () => {
  const fetchImpl = fakeFetchOnce([
    jsonResponse(201, {
      session_code: 's_xyz',
      user_code: 'AB12-CD34',
      authorize_url: 'https://nexttoken.test/app/auth/cli-auth?user_code=AB12-CD34',
      expires_in: 900,
      interval: 0,  // poll immediately for fast tests
    }),
    jsonResponse(200, {
      api_key: 'nt_abc',
      user_email: 'a@b.com',
      tag: 'CLI · host · 2026-05-06',
    }),
  ]);
  const result = await pollingAuthFlow({
    apiBaseUrl: 'https://api.example.test',
    useBrowser: false,
    fetchImpl,
  });
  assert.equal(result.api_key, 'nt_abc');
  assert.equal(result.user_email, 'a@b.com');
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(fetchImpl.calls[0].url, /\/cli-auth\/start$/);
  assert.match(fetchImpl.calls[1].url, /\/cli-auth\/poll$/);
  const sentPoll = JSON.parse(fetchImpl.calls[1].init.body);
  assert.equal(sentPoll.session_code, 's_xyz');
}));

test('polling: 202 pending → keeps polling → eventually 200', withSilencedStderr(async () => {
  const fetchImpl = fakeFetchOnce([
    jsonResponse(201, {
      session_code: 's', user_code: 'AA11-BB22',
      authorize_url: 'https://x', expires_in: 900, interval: 0,
    }),
    jsonResponse(202, { error: 'authorization_pending' }),
    jsonResponse(202, { error: 'authorization_pending' }),
    jsonResponse(200, { api_key: 'nt_z', user_email: 'a@b.com', tag: 't' }),
  ]);
  const result = await pollingAuthFlow({
    apiBaseUrl: 'https://api.example.test',
    useBrowser: false,
    fetchImpl,
  });
  assert.equal(result.api_key, 'nt_z');
  assert.equal(fetchImpl.calls.length, 4);
}));

test('polling: 410 access_denied throws with denial message', withSilencedStderr(async () => {
  const fetchImpl = fakeFetchOnce([
    jsonResponse(201, {
      session_code: 's', user_code: 'AA11-BB22',
      authorize_url: 'https://x', expires_in: 900, interval: 0,
    }),
    jsonResponse(410, { error: 'access_denied' }),
  ]);
  await assert.rejects(
    () => pollingAuthFlow({
      apiBaseUrl: 'https://api.example.test',
      useBrowser: false,
      fetchImpl,
    }),
    /denied/i,
  );
}));

test('polling: 410 expired throws with expiry message', withSilencedStderr(async () => {
  const fetchImpl = fakeFetchOnce([
    jsonResponse(201, {
      session_code: 's', user_code: 'AA11-BB22',
      authorize_url: 'https://x', expires_in: 900, interval: 0,
    }),
    jsonResponse(410, { error: 'expired_or_unknown_token' }),
  ]);
  await assert.rejects(
    () => pollingAuthFlow({
      apiBaseUrl: 'https://api.example.test',
      useBrowser: false,
      fetchImpl,
    }),
    /expired/i,
  );
}));

test('polling: start failure surfaces server status + body', withSilencedStderr(async () => {
  const fetchImpl = fakeFetchOnce([
    jsonResponse(503, { detail: 'temporarily unavailable' }),
  ]);
  await assert.rejects(
    () => pollingAuthFlow({
      apiBaseUrl: 'https://api.example.test',
      useBrowser: false,
      fetchImpl,
    }),
    /Auth start failed: HTTP 503/,
  );
}));

test('polling: never opens a localhost listener (no callback URL)', withSilencedStderr(async () => {
  const fetchImpl = fakeFetchOnce([
    jsonResponse(201, {
      session_code: 's', user_code: 'AA11-BB22',
      authorize_url: 'https://x', expires_in: 900, interval: 0,
    }),
    jsonResponse(200, { api_key: 'k', user_email: 'a@b.com', tag: 't' }),
  ]);
  await pollingAuthFlow({
    apiBaseUrl: 'https://api.example.test',
    useBrowser: false,
    fetchImpl,
  });
  // The /start request body must NOT carry a callback_port — that was
  // the loopback design; the unified flow doesn't bind any local port.
  const startBody = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(startBody.callback_port, undefined);
  assert.equal(startBody.callback, undefined);
}));
