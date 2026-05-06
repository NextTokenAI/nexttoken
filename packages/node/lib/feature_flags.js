'use strict';

/**
 * Browser-based auth uses the unified poll-based flow against the backend's
 * /api/public/cli-auth/start + /api/public/cli-auth/poll endpoints (and
 * /api/cli-auth/authorize from the frontend authorize page). These are
 * shipped, so the default is now ON.
 *
 * The off-switch (`NEXTTOKEN_CLI_BROWSER_AUTH=0`) is kept so an adopter
 * pointed at a private/older backend that doesn't have the endpoints yet
 * can disable the implicit auth trigger and fall back to the
 * NEXTTOKEN_API_KEY path without a CLI version pin.
 */
function browserAuthEnabled(env = process.env) {
  if (env.NEXTTOKEN_CLI_BROWSER_AUTH === '0') return false;
  return true;
}

module.exports = { browserAuthEnabled };
