import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository, MysqlRepository } from '../src/repository.js';
import { composeRepositoryBundles } from '../src/repositories/compose-bundles.js';

const baseline = JSON.parse(readFileSync(
  new URL('./fixtures/repository-methods-baseline.json', import.meta.url), 'utf8'
));

function publicMethods(adapter) {
  return Object.getOwnPropertyNames(adapter.prototype)
    .filter((name) => name !== 'constructor')
    .sort();
}

test('repository adapter public method lists match the pre-extraction baseline', () => {
  assert.deepEqual(publicMethods(MemoryRepository), [...baseline.memory].sort());
  assert.deepEqual(publicMethods(MysqlRepository), [...baseline.mysql].sort());
});

test('repository bundle composition rejects duplicate method names', () => {
  assert.throws(() => composeRepositoryBundles({
    communications: { listMessages() {} },
    staff: { listMessages() {} }
  }), /defined by both "communications" and "staff"/);
});
