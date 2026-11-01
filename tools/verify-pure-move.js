const { execFileSync } = require('node:child_process');
const acorn = require('acorn');
const path = require('node:path');
const commit = process.argv[2];

if (!commit) {
  console.error('Usage: node tools/verify-pure-move.js <commit>');
  process.exit(2);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function parse(source, filename) {
  return acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
    sourceFile: filename
  });
}

function declaration(node) {
  return node.type === 'ExportNamedDeclaration' ? node.declaration : node;
}

function classMethods(source, name) {
  const tree = parse(source, 'repository.js');
  const cls = tree.body.map(declaration).find((node) =>
    node?.type === 'ClassDeclaration' && node.id.name === name);
  if (!cls) return new Map();
  return new Map(cls.body.body.filter((node) =>
    node.type === 'MethodDefinition' && node.key.type === 'Identifier')
    .map((node) => [node.key.name, { node, source }]));
}

function bundleMethods(source) {
  const tree = parse(source, 'repository-bundle.js');
  const result = new Map();
  for (const statement of tree.body) {
    const node = declaration(statement);
    if (node?.type !== 'VariableDeclaration') continue;
    for (const variable of node.declarations) {
      if (!/^(memory|mysql).+Bundle$/.test(variable.id.name) ||
          variable.init?.type !== 'ObjectExpression') continue;
      for (const property of variable.init.properties) {
        if (property.type !== 'Property' || property.key.type !== 'Identifier' ||
            property.value.type !== 'FunctionExpression') continue;
        result.set(property.key.name, { node: property, source, bundle: variable.id.name });
      }
    }
  }
  return result;
}

function normalizeAst(node) {
  if (Array.isArray(node)) return node.map(normalizeAst);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(Object.keys(node).sort()
    .filter((key) => !['start', 'end', 'loc', 'range', 'raw'].includes(key))
    .map((key) => [key, normalizeAst(node[key])]));
}

function methodBody(method) {
  if (method.node.type === 'MethodDefinition') return method.node.value.body;
  return method.node.value.body;
}

function sourceBody(method) {
  const body = methodBody(method);
  return method.source.slice(body.start, body.end).trim().split(/\r?\n/);
}

function bodyDiff(before, after) {
  const oldLines = sourceBody(before);
  const newLines = sourceBody(after);
  const oldNormalized = oldLines.map((line) => line.trim());
  const newNormalized = newLines.map((line) => line.trim());
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length &&
      oldNormalized[prefix] === newNormalized[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix &&
      oldNormalized[oldLines.length - 1 - suffix] === newNormalized[newLines.length - 1 - suffix]) {
    suffix++;
  }
  return [
    ...oldLines.slice(prefix, oldLines.length - suffix).map((line) => `-${line}`),
    ...newLines.slice(prefix, newLines.length - suffix).map((line) => `+${line}`)
  ];
}

let parentRepository;
let currentRepository;
let bundlePaths;
try {
  parentRepository = git(['show', `${commit}^:backend/src/repository.js`]);
  currentRepository = git(['show', `${commit}:backend/src/repository.js`]);
  bundlePaths = git([
    'ls-tree', '-r', '--name-only', commit, '--', 'backend/src/repositories'
  ]).split(/\r?\n/).filter((file) =>
    /^backend\/src\/repositories\/(memory|mysql)\/.+\.repository\.js$/.test(file));
} catch (error) {
  console.error(`Unable to inspect extraction commit ${commit}: ${error.message}`);
  process.exit(2);
}

const oldClasses = {
  MemoryRepository: classMethods(parentRepository, 'MemoryRepository'),
  MysqlRepository: classMethods(parentRepository, 'MysqlRepository')
};
const currentClasses = {
  MemoryRepository: classMethods(currentRepository, 'MemoryRepository'),
  MysqlRepository: classMethods(currentRepository, 'MysqlRepository')
};
const moved = new Map();
for (const [adapter, oldMethods] of Object.entries(oldClasses)) {
  for (const [name, method] of oldMethods) {
    if (!currentClasses[adapter].has(name)) moved.set(`${adapter}.${name}`, { adapter, name, method });
  }
}

const newBundles = new Map();
for (const file of bundlePaths) {
  const source = git(['show', `${commit}:${file}`]);
  const adapter = file.includes('/memory/') ? 'MemoryRepository' : 'MysqlRepository';
  for (const [name, method] of bundleMethods(source)) {
    if (moved.has(`${adapter}.${name}`)) {
      newBundles.set(`${adapter}.${name}`, method);
    }
  }
}

const differences = [];
const missing = [];
for (const [key, entry] of moved) {
  const extracted = newBundles.get(key);
  if (!extracted) {
    missing.push(key);
    continue;
  }
  const oldAst = normalizeAst(methodBody(entry.method));
  const newAst = normalizeAst(methodBody(extracted));
  if (JSON.stringify(oldAst) !== JSON.stringify(newAst)) {
    differences.push({
      key,
      diff: bodyDiff(entry.method, extracted)
    });
  }
}

console.log(`Commit: ${commit}`);
console.log(`Moved methods compared: ${moved.size}`);
if (!differences.length && !missing.length) {
  console.log('Methods with differing bodies: none');
} else {
  console.log(`Methods with differing bodies: ${differences.length}`);
  for (const { key, diff } of differences) {
    console.log(`\n${key}`);
    console.log(`--- parent:${path.basename(key.split('.')[0])}.${key.split('.').at(-1)}`);
    console.log(`+++ extracted:${key.split('.').at(-1)}`);
    console.log(diff.length ? diff.join('\n') : '(AST differs; formatting-only diff)');
  }
  for (const key of missing) console.log(`\nMissing extracted bundle method: ${key}`);
}

if (missing.length) process.exitCode = 2;
else if (differences.length) process.exitCode = 1;
