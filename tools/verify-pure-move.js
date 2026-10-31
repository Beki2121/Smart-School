const { execFileSync } = require('node:child_process');

const commit = process.argv[2];
if (!commit) {
  console.error('Usage: node tools/verify-pure-move.js <commit>');
  process.exit(2);
}

let diff;
try {
  diff = execFileSync('git', [
    'show', '--format=', '--no-ext-diff', '--find-renames', '--unified=0', commit
  ], { encoding: 'utf8' });
} catch (error) {
  console.error(`Unable to read commit ${commit}: ${error.message}`);
  process.exit(2);
}

const added = new Set();
const removed = new Set();
for (const line of diff.split(/\r?\n/)) {
  if ((!line.startsWith('+') || line.startsWith('+++')) &&
      (!line.startsWith('-') || line.startsWith('---'))) continue;
  let content = line.slice(1).trim();
  if (!content || /^(import|export)\s*[{*]/.test(content) ||
      /^(import|export)\b/.test(content) && !/^export\s+(?:const|let|var|function|async|class|default)\b/.test(content) ||
      /^\}\s*from\b/.test(content)) continue;
  content = content.replace(/^export\s+default\s+/, '').replace(/^export\s+/, '');
  (line.startsWith('+') ? added : removed).add(content);
}

const addedOnly = [...added].filter((line) => !removed.has(line)).sort();
const removedOnly = [...removed].filter((line) => !added.has(line)).sort();
console.log(`Commit: ${commit}`);
console.log(`Added but not removed (${addedOnly.length}):`);
console.log(addedOnly.length ? addedOnly.map((line) => `+ ${line}`).join('\n') : 'none');
console.log(`Removed but not added (${removedOnly.length}):`);
console.log(removedOnly.length ? removedOnly.map((line) => `- ${line}`).join('\n') : 'none');
console.log(addedOnly.length || removedOnly.length
  ? 'Classification: contains changed lines (not a pure move)'
  : 'Classification: pure move (filtered lines match)');
if (addedOnly.length || removedOnly.length) process.exitCode = 1;
