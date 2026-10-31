import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../seeds/001_demo.js';
import { seed as seedShowcase } from '../seeds/002_showcase.js';

describe('production demo seeding safeguards', () => {
  it('requires explicit opt-in before accessing the database', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowDemoSeed = process.env.ALLOW_DEMO_SEED;
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_DEMO_SEED;
    try {
      await assert.rejects(
        seed(() => {
          throw new Error('The database must not be accessed without opt-in.');
        }),
        /Demo seeding requires ALLOW_DEMO_SEED/
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalAllowDemoSeed === undefined) delete process.env.ALLOW_DEMO_SEED;
      else process.env.ALLOW_DEMO_SEED = originalAllowDemoSeed;
    }
  });

  it('allows the platform system organization while protecting production school data', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowDemoSeed = process.env.ALLOW_DEMO_SEED;
    const originalEmail = process.env.DEMO_LOGIN_EMAIL;
    const originalPassword = process.env.DEMO_LOGIN_PASSWORD;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEMO_SEED = 'true';
    process.env.DEMO_LOGIN_EMAIL = 'demo@example.test';
    process.env.DEMO_LOGIN_PASSWORD = 'T7!DemoSchool-AccessKey-2026';
    const checkedTables = [];
    const knex = (table) => {
      checkedTables.push(table);
      return {
        whereNot() { return this; },
        async first() { return null; },
        insert() { throw new Error('Production seed passed its empty-database guard.'); }
      };
    };
    try {
      await assert.rejects(seed(knex), /passed its empty-database guard/);
      assert.deepEqual(checkedTables, ['organizations', 'campuses', 'users', 'students', 'organizations']);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalAllowDemoSeed === undefined) delete process.env.ALLOW_DEMO_SEED;
      else process.env.ALLOW_DEMO_SEED = originalAllowDemoSeed;
      if (originalEmail === undefined) delete process.env.DEMO_LOGIN_EMAIL;
      else process.env.DEMO_LOGIN_EMAIL = originalEmail;
      if (originalPassword === undefined) delete process.env.DEMO_LOGIN_PASSWORD;
      else process.env.DEMO_LOGIN_PASSWORD = originalPassword;
    }
  });

  it('requires the same explicit opt-in before showcase seeding accesses the database', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowDemoSeed = process.env.ALLOW_DEMO_SEED;
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_DEMO_SEED;
    try {
      await assert.rejects(
        seedShowcase(() => {
          throw new Error('The database must not be accessed without opt-in.');
        }),
        /Showcase seeding requires ALLOW_DEMO_SEED/
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalAllowDemoSeed === undefined) delete process.env.ALLOW_DEMO_SEED;
      else process.env.ALLOW_DEMO_SEED = originalAllowDemoSeed;
    }
  });

  it('refuses to write showcase data outside its dedicated demo school', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowDemoSeed = process.env.ALLOW_DEMO_SEED;
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEMO_SEED = 'true';
    const queriedTables = [];
    const knex = (table) => {
      queriedTables.push(table);
      return {
        where() { return this; },
        async first() { return null; }
      };
    };
    try {
      await assert.rejects(seedShowcase(knex), /dedicated demo organization and campus/);
      assert.deepEqual(queriedTables, ['organizations']);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalAllowDemoSeed === undefined) delete process.env.ALLOW_DEMO_SEED;
      else process.env.ALLOW_DEMO_SEED = originalAllowDemoSeed;
    }
  });
});
