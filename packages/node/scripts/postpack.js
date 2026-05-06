#!/usr/bin/env node
'use strict';

/**
 * Runs after `npm pack` / `npm publish`. Restores the working-tree
 * package.json from the pre-pack backup so local dev keeps its
 * `file:../typescript` SDK dep. No-op when no backup exists.
 */

const fs = require('node:fs');
const path = require('node:path');

const PKG_PATH = path.join(__dirname, '..', 'package.json');
const BACKUP_PATH = path.join(__dirname, '..', 'package.json.prepack-backup');

function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    process.stdout.write('postpack: no backup file found — nothing to restore\n');
    return;
  }
  const backup = fs.readFileSync(BACKUP_PATH, 'utf8');
  fs.writeFileSync(PKG_PATH, backup);
  fs.unlinkSync(BACKUP_PATH);
  process.stdout.write('postpack: restored original package.json (file: dep)\n');
}

main();
