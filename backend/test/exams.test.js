import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateWeightedResult, nextExamStatus } from '../src/repositories/exams.mappers.js';

describe('exam result calculations', () => {
  it('uses integer basis points, round-half-up, and reports missing exam marks', () => {
    const exams = [
      { id: 'one', weightBasisPoints: 5000 },
      { id: 'two', weightBasisPoints: 5000 }
    ];
    const result = calculateWeightedResult(exams, new Map([
      ['one', { value: 1, maxValue: 3 }]
    ]));

    assert.deepEqual(result, {
      scoreBasisPoints: 1667,
      missingExamCount: 1,
      basis: [
        {
          examId: 'one', weightBasisPoints: 5000,
          scoreBasisPoints: 3333, weightedBasisPoints: 1667
        },
        {
          examId: 'two', weightBasisPoints: 5000,
          scoreBasisPoints: null, weightedBasisPoints: 0
        }
      ]
    });
  });

  it('caps a weighted score at 100 percent', () => {
    const result = calculateWeightedResult([
      { id: 'one', weightBasisPoints: 10000 }
    ], new Map([['one', { value: 11, maxValue: 10 }]]));
    assert.equal(result.scoreBasisPoints, 10000);
  });
});

describe('exam status progression', () => {
  const exam = { status: 'marks_open', isLegacy: false };

  it('does not progress until the expected marks are present and non-draft', () => {
    assert.equal(nextExamStatus(exam, [], 1), 'marks_open');
    assert.equal(nextExamStatus(exam, [{ state: 'draft' }], 1), 'marks_open');
    assert.equal(nextExamStatus(exam, [{ state: 'submitted' }], 1), 'submitted');
  });

  it('progresses through review, approval, and publication states', () => {
    assert.equal(nextExamStatus(exam, [{ state: 'submitted' }, { state: 'approved' }], 2), 'reviewed');
    assert.equal(nextExamStatus(exam, [{ state: 'approved' }, { state: 'locked' }], 2), 'approved');
    assert.equal(nextExamStatus(exam, [{ state: 'locked' }], 1), 'published');
  });
});
