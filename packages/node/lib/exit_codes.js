'use strict';

const EXIT = {
  OK: 0,
  GENERAL: 1,
  USAGE: 2,
  AUTH: 3,
  AGENT_FAILURE: 4,
  NETWORK: 5,
};

/**
 * Map an SDK / Node error to one of our standard exit codes.
 *
 * Only checks shape (constructor name + select fields), not instanceof —
 * the CLI imports the SDK at runtime and the error classes need to be
 * comparable across CommonJS / ESM module boundaries.
 */
function exitCodeForError(err) {
  if (!err) return EXIT.GENERAL;
  const name = err && err.name;

  if (name === 'AuthError') return EXIT.AUTH;
  if (name === 'BadRequestError') return EXIT.USAGE;
  if (name === 'TimeoutError') return EXIT.AGENT_FAILURE;
  if (name === 'RunCapExceededError') return EXIT.AGENT_FAILURE;
  if (name === 'ServerError') return EXIT.NETWORK;
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' ||
      err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN' ||
      (name === 'TypeError' && /fetch failed/i.test(err.message || ''))) {
    return EXIT.NETWORK;
  }
  return EXIT.GENERAL;
}

/**
 * Map a terminal RunResult.status to an exit code.
 * Only used after a successful HTTP cycle that returned a terminal row.
 */
function exitCodeForRunStatus(status) {
  if (status === 'completed') return EXIT.OK;
  if (status === 'failed' || status === 'timeout' || status === 'cancelled') {
    return EXIT.AGENT_FAILURE;
  }
  return EXIT.GENERAL;
}

module.exports = { EXIT, exitCodeForError, exitCodeForRunStatus };
