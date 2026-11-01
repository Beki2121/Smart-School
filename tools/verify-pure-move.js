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

const added = [];
const removed = [];
let currentFileIsMarkdown = false;
for (const line of diff.split(/\r?\n/)) {
  if (line.startsWith('diff --git ')) {
    const paths = line.slice('diff --git '.length).split(' ');
    currentFileIsMarkdown = paths.some((path) => /\.md$/i.test(path.replace(/^[ab]\//, '')));
    continue;
  }
  if (currentFileIsMarkdown) continue;
  if ((!line.startsWith('+') || line.startsWith('+++')) &&
      (!line.startsWith('-') || line.startsWith('---'))) continue;
  let content = line.slice(1).trim();
  if (!content || /^(import|export)\s*[{*]/.test(content) ||
      /^(import|export)\b/.test(content) && !/^export\s+(?:const|let|var|function|async|class|default)\b/.test(content) ||
      /^\}\s*from\b/.test(content)) continue;
  content = content.replace(/^export\s+default\s+/, '').replace(/^export\s+/, '');
  (line.startsWith('+') ? added : removed).push(content);
}

function unmatchedLines(sourceLines, counterpartLines) {
  const counterpartCounts = new Map();
  for (const line of counterpartLines) {
    counterpartCounts.set(line, (counterpartCounts.get(line) ?? 0) + 1);
  }
  const unmatched = [];
  for (const line of sourceLines) {
    const count = counterpartCounts.get(line) ?? 0;
    if (count > 0) counterpartCounts.set(line, count - 1);
    else unmatched.push(line);
  }
  return unmatched.sort();
}

const addedOnly = unmatchedLines(added, removed);
const removedOnly = unmatchedLines(removed, added);
console.log(`Commit: ${commit}`);
console.log(`Added but not removed (${addedOnly.length}):`);
console.log(addedOnly.length ? addedOnly.map((line) => `+ ${line}`).join('\n') : 'none');
console.log(`Removed but not added (${removedOnly.length}):`);
console.log(removedOnly.length ? removedOnly.map((line) => `- ${line}`).join('\n') : 'none');
console.log(addedOnly.length || removedOnly.length
  ? 'Classification: contains changed lines (not a pure move)'
  : 'Classification: pure move (filtered lines match)');
if (addedOnly.length || removedOnly.length) process.exitCode = 1;
