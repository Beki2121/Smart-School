import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startSubscriptionExpiryWorker } from '../src/subscription-expiry-worker.js';

describe('subscription expiry worker', () => {
  it('does not start for memory repositories', () => {
    let processCalls = 0;
    const repo = {
      mode: 'memory',
      async processSubscriptionExpiryNotifications() {
        processCalls += 1;
      }
    };

    assert.equal(startSubscriptionExpiryWorker(repo, null, { warn() {} }), null);
    assert.equal(processCalls, 0);
  });
});
