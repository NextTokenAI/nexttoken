'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const { version: VERSION } = require('../package.json');
const BINARY_NAME = 'nexttoken-runtime';
const DOWNLOAD_BASE = 'https://dl.nexttoken.co/runtime';

function getPlatformKey() {
  const platform = os.platform();
  const arch = os.arch();
  const map = {
    'darwin-x64': 'macos-x64',
    'darwin-arm64': 'macos-arm64',
    'linux-x64': 'linux-x64',
    'linux-arm64': 'linux-arm64',
    'win32-x64': 'windows-x64',
  };
  const key = `${platform}-${arch}`;
  const mapped = map[key];
  if (!mapped) {
    process.stderr.write(`Unsupported platform: ${key}\n`);
    process.stderr.write('Supported: macos-x64, macos-arm64, linux-x64, linux-arm64, windows-x64\n');
    process.exit(1);
  }
  return mapped;
}

function getBinaryPath() {
  const cacheDir = path.join(os.homedir(), '.nexttoken');
  const platformKey = getPlatformKey();
  const binaryName = os.platform() === 'win32' ? `${BINARY_NAME}.exe` : BINARY_NAME;
  return path.join(cacheDir, VERSION, platformKey, binaryName);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });
    const file = fs.createWriteStream(dest);

    const request = (targetUrl) => {
      https.get(targetUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) { request(redirectUrl); return; }
        }
        if (response.statusCode !== 200) {
          fs.unlinkSync(dest);
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          if (os.platform() !== 'win32') fs.chmodSync(dest, 0o755);
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };

    request(url);
  });
}

async function ensureBinary() {
  const binaryPath = getBinaryPath();
  if (fs.existsSync(binaryPath)) return binaryPath;
  process.stdout.write('Setting up NextToken Runtime...\n');
  try {
    await downloadFile(`${DOWNLOAD_BASE}/${BINARY_NAME}`, binaryPath);
    process.stdout.write('Download complete.\n');
    return binaryPath;
  } catch (error) {
    process.stderr.write(`Failed to download NextToken Runtime: ${error.message}\n`);
    process.stderr.write('Please check your internet connection and try again.\n');
    process.exit(1);
  }
}

/**
 * Spawn the runtime binary with the given args, inheriting stdio.
 * Returns the spawned child's eventual exit code.
 */
async function spawnRuntime(args = []) {
  const binaryPath = await ensureBinary();
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: 'inherit', env: process.env });
    child.on('close', (code) => resolve(code || 0));
    child.on('error', (err) => reject(err));
  });
}

module.exports = { ensureBinary, spawnRuntime, getBinaryPath, VERSION };
