import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const register = JSON.parse(readFileSync(
  new URL('./fixtures/sit-cases.json', import.meta.url), 'utf8'
));
const allCases = [
  ...register.roleMenuCases,
  ...register.commonFunctionalityCases,
  ...register.phaseModuleCases
];
const validStatuses = new Set([
  'PASS', 'FAIL', 'BLOCKED', 'NOT TESTED', 'NOT APPLICABLE'
]);

describe('SIT checklist case register', () => {
  it('maps every requested role/menu, common-functionality and module case', () => {
    assert.equal(register.roles.length, 15);
    assert.equal(register.counts.roleMenu, 230);
    assert.equal(register.counts.common, 18);
    assert.equal(register.counts.modules, 27);
    assert.equal(register.roleMenuCases.length, 230);
    assert.equal(register.commonFunctionalityCases.length, 18);
    assert.equal(register.phaseModuleCases.length, 27);
    assert.equal(register.criticalWorkflows.length, 8);
    assert.equal(new Set(allCases.map(({ id }) => id)).size, allCases.length);
  });

  for (const testCase of register.roleMenuCases) {
    it(`${testCase.id}: maps ${testCase.role} / ${testCase.menu}`, () => {
      assert.ok(register.roles.some((role) =>
        role.role === testCase.role && role.roleKey === testCase.roleKey));
      assert.ok(testCase.scenario.length > 0);
      assert.ok(testCase.preconditions.length > 0);
      assert.ok(testCase.testData.length > 0);
      assert.ok(testCase.steps.length > 0);
      assert.ok(testCase.expectedResult.length > 0);
      assert.ok(testCase.actualResult.length > 0);
      assert.ok(validStatuses.has(testCase.status));
      assert.match(testCase.priority, /^P[0-3]$/);
      if (testCase.status === 'BLOCKED') assert.ok(testCase.defectReference);
    });
  }

  for (const testCase of register.commonFunctionalityCases) {
    it(`${testCase.id}: maps common check ${testCase.menu}`, () => {
      assert.ok(testCase.scenario.length > 0);
      assert.ok(testCase.steps.length > 0);
      assert.ok(testCase.expectedResult.length > 0);
      assert.ok(validStatuses.has(testCase.status));
    });
  }

  for (const testCase of register.phaseModuleCases) {
    it(`${testCase.id}: maps ${testCase.phase} module ${testCase.menu}`, () => {
      assert.ok(testCase.scenario.length > 0);
      assert.ok(testCase.steps.length > 0);
      assert.ok(testCase.expectedResult.length > 0);
      assert.ok(validStatuses.has(testCase.status));
      if (testCase.status === 'PASS') assert.ok(testCase.evidence.length > 0);
      if (testCase.status === 'BLOCKED') assert.ok(testCase.defectReference);
    });
  }

  it('keeps transport requirements blocked until the scope conflict is resolved', () => {
    const transportMenus = register.roleMenuCases.filter((testCase) =>
      testCase.role === 'Transport Manager');
    const transportModule = register.phaseModuleCases.find((testCase) =>
      testCase.menu.startsWith('Transport management'));
    assert.equal(transportMenus.length, 12);
    assert.ok(transportMenus.every((testCase) =>
      testCase.status === 'BLOCKED' && testCase.defectReference === 'SCOPE-TRANSPORT-001'));
    assert.equal(transportModule.status, 'BLOCKED');
  });

  it('maps all eight critical workflows and keeps unexecuted chains explicit', () => {
    assert.deepEqual(register.criticalWorkflows.map(({ id }) => id),
      ['WF-A', 'WF-B', 'WF-C', 'WF-D', 'WF-E', 'WF-F', 'WF-G', 'WF-H']);
    for (const workflow of register.criticalWorkflows) {
      assert.ok(workflow.scenario.length > 0);
      assert.ok(workflow.actualResult.length > 0);
      assert.ok(validStatuses.has(workflow.status));
      if (workflow.status === 'PASS') assert.ok(workflow.evidence.length > 0);
    }
    assert.equal(register.criticalWorkflows.find(({ id }) => id === 'WF-F').status, 'NOT TESTED');
    assert.equal(register.criticalWorkflows.find(({ id }) => id === 'WF-H').status, 'NOT TESTED');
  });
});
