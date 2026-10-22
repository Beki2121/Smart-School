import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (path.endsWith('.js')) result.push(path);
  }
  return result;
}

const files = [];
for (const root of ['src', 'migrations', 'seeds', 'test']) {
  files.push(...await filesUnder(root));
}
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (check.status !== 0) process.exit(check.status ?? 1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
