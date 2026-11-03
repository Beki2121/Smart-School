export function examConflict(entries) {
  const error = new Error('The exam schedule conflicts with an existing entry.');
  error.status = 409;
  error.code = 'EXAM_SCHEDULE_CONFLICT';
  error.details = entries;
  return error;
}

export function examWeightConflict(examTypes, totalBasisPoints) {
  const error = new Error('Exam type weights must total exactly 100% before marks can open.');
  error.status = 409;
  error.code = 'EXAM_WEIGHTS_INVALID';
  error.details = {
    expectedBasisPoints: 10000,
    actualBasisPoints: totalBasisPoints,
    examTypes
  };
  return error;
}

export function calculateWeightedResult(exams, marksByExamId) {
  let weightedBasisPoints = 0;
  let missingExamCount = 0;
  const basis = [];
  for (const exam of exams) {
    const mark = marksByExamId.get(exam.id);
    if (!mark) {
      missingExamCount += 1;
      basis.push({
        examId: exam.id, weightBasisPoints: exam.weightBasisPoints,
        scoreBasisPoints: null, weightedBasisPoints: 0
      });
      continue;
    }
    const scoreMinor = Math.round(Number(mark.value) * 100);
    const maximumMinor = Math.round(Number(mark.maxValue) * 100);
    const scoreBasisPoints = Math.floor((scoreMinor * 10000 + Math.floor(maximumMinor / 2)) / maximumMinor);
    const weighted = Math.floor(
      (scoreBasisPoints * exam.weightBasisPoints + 5000) / 10000
    );
    weightedBasisPoints += weighted;
    basis.push({
      examId: exam.id, weightBasisPoints: exam.weightBasisPoints,
      scoreBasisPoints, weightedBasisPoints: weighted
    });
  }
  return {
    scoreBasisPoints: Math.min(10000, weightedBasisPoints),
    missingExamCount,
    basis
  };
}

export function nextExamStatus(exam, marks, expectedStudentCount) {
  if (exam.isLegacy) return exam.status;
  if (!expectedStudentCount || marks.length < expectedStudentCount ||
      marks.some((mark) => mark.state === 'draft')) return 'marks_open';
  if (marks.every((mark) => mark.state === 'locked')) return 'published';
  if (marks.every((mark) => mark.state === 'approved' || mark.state === 'locked')) return 'approved';
  if (marks.some((mark) => mark.state === 'approved' || mark.state === 'locked')) return 'reviewed';
  if (marks.every((mark) => mark.state === 'submitted')) return 'submitted';
  return exam.status;
}
