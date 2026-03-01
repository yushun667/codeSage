#!/usr/bin/env node
// Copies backend/dist and production node_modules into extension/backend/
// so they can be included in the VSIX package.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BACKEND_SRC = path.join(ROOT, 'backend');
const BACKEND_DST = path.join(ROOT, 'extension', 'backend');

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// Clean previous bundle
if (fs.existsSync(BACKEND_DST)) {
  fs.rmSync(BACKEND_DST, { recursive: true, force: true });
}

// Copy compiled output
console.log('Copying backend/dist...');
copyDirSync(path.join(BACKEND_SRC, 'dist'), path.join(BACKEND_DST, 'dist'));

// Install production-only dependencies into a temp location and copy
console.log('Installing backend production dependencies...');
const tmpModules = path.join(BACKEND_SRC, 'node_modules_prod');
fs.mkdirSync(tmpModules, { recursive: true });

// Copy package.json for npm install
fs.copyFileSync(
  path.join(BACKEND_SRC, 'package.json'),
  path.join(tmpModules, 'package.json')
);
execSync('npm install --omit=dev --ignore-scripts', {
  cwd: tmpModules,
  stdio: 'inherit',
});

copyDirSync(
  path.join(tmpModules, 'node_modules'),
  path.join(BACKEND_DST, 'node_modules')
);

// Copy package.json for require resolution
fs.copyFileSync(
  path.join(BACKEND_SRC, 'package.json'),
  path.join(BACKEND_DST, 'package.json')
);

// Cleanup
fs.rmSync(tmpModules, { recursive: true, force: true });

console.log('Backend bundled into extension/backend/');
