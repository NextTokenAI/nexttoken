#!/usr/bin/env node
'use strict';

/**
 * Runs immediately before `npm pack` / `npm publish` reads package.json
 * for the tarball. Swaps the local-dev `file:../typescript` SDK dep to a
 * real semver range pinned at the SDK's current published version. The
 * pre-swap manifest is saved to `package.json.prepack-backup` and
 * restored by `postpack.js` so the working tree is unchanged after pack.
 *
 * Why: shipping `file:../typescript` to npm would publish a tarball that
 * tries to resolve a sibling path users do not have, breaking
 * `npx @nexttoken/cli` and registry installs.
 */

const fs = require('node:fs');
const path = require('node:path');

const PKG_PATH = path.join(__dirname, '..', 'package.json');
const BACKUP_PATH = path.join(__dirname, '..', 'package.json.prepack-backup');
const SDK_PKG_PATH = path.join(__dirname, '..', '..', 'typescript', 'package.json');
const SDK_DEP_NAME = '@nexttoken/sdk';

function main() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const sdkPkg = JSON.parse(fs.readFileSync(SDK_PKG_PATH, 'utf8'));

  const sdkVersion = sdkPkg.version;
  if (!sdkVersion) throw new Error(`SDK package at ${SDK_PKG_PATH} has no version field`);

  const currentDep = (pkg.dependencies && pkg.dependencies[SDK_DEP_NAME]) || '';
  if (!currentDep.startsWith('file:') && !currentDep.startsWith('link:') &&
      !currentDep.startsWith('workspace:')) {
    // Already a real range — leave it alone. This handles the case where
    // someone has already manually swapped the dep.
    process.stdout.write(`prepack: ${SDK_DEP_NAME} is already "${currentDep}" — no rewrite needed\n`);
    return;
  }

  // Save the original.
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(pkg, null, 2) + '\n');

  // Swap the dep to the SDK's current version (caret range so patch
  // updates flow through, matching npm conventions).
  pkg.dependencies[SDK_DEP_NAME] = `^${sdkVersion}`;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

  process.stdout.write(
    `prepack: rewrote ${SDK_DEP_NAME} from "${currentDep}" → "^${sdkVersion}" (backup at ${BACKUP_PATH})\n`,
  );
}

main();
