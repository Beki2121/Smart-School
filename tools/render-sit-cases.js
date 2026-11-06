const { readFileSync, writeFileSync } = require('node:fs');

const register = JSON.parse(readFileSync('backend/test/fixtures/sit-cases.json', 'utf8'));
const escapeCell = (value) => String(value ?? 'None').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
const sections = [
  ['Role/menu combinations', register.roleMenuCases],
  ['Common functionality', register.commonFunctionalityCases],
  ['Phase 1 and Phase 2 modules', register.phaseModuleCases],
  ['Critical end-to-end workflows', register.criticalWorkflows]
];
const lines = [
  '# SIT test cases',
  '',
  `Source checklist: ${register.source}.`,
  '',
  `This register maps ${register.counts.roleMenu} role/menu rows, ${register.counts.common} common checks, and ${register.counts.modules} Phase 1/2 modules. ` +
    'A PASS is limited to the exact evidence listed; mapping/metadata checks are not functional workflow passes.',
  ''
];

for (const [title, cases] of sections) {
  lines.push(`## ${title}`, '');
  for (const testCase of cases) {
    lines.push(`### ${testCase.id} — ${testCase.menu}`, '');
    lines.push('| Field | Value |', '|---|---|');
    for (const field of [
      'phase', 'module', 'role', 'roleKey', 'scenario', 'preconditions', 'testData',
      'steps', 'expectedResult', 'actualResult', 'status', 'evidence',
      'defectReference', 'priority'
    ]) {
      const value = field === 'evidence'
        ? testCase.evidence.length ? testCase.evidence.join('<br>') : 'None'
        : testCase[field];
      lines.push(`| ${field} | ${escapeCell(value) || 'None'} |`);
    }
    lines.push('');
  }
}

writeFileSync('docs/SIT_TEST_CASES.md', `${lines.join('\n').trimEnd()}\n`, 'utf8');
console.log(`Rendered ${register.counts.roleMenu + register.counts.common + register.counts.modules} checklist cases and ${register.criticalWorkflows.length} workflow cases.`);
