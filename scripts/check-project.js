#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const skip = new Set(['.git', 'node_modules', '.netlify', 'dist']);
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.js')) {
      const relative = path.relative(root, file);
      const isFunction = relative.startsWith('netlify/functions/');
      const command = isFunction
        ? ['--check', file]
        : ['--input-type=module', '--check'];
      const result = spawnSync(process.execPath, command, isFunction ? { encoding: 'utf8' } : { input: fs.readFileSync(file, 'utf8'), encoding: 'utf8' });
      if (result.status !== 0) failures.push(relative + ': ' + (result.stderr || result.stdout || 'syntax check failed').trim());
    }
  }
}
walk(root);
if (failures.length) {
  console.error('Project checks failed:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('Project JavaScript syntax checks passed.');
