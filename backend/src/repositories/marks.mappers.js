import { createHash } from 'node:crypto';

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildTermMarksSummary(term, marks, subjects) {
  const grouped = new Map();
  const allStudents = new Set();
  let earned = 0;
  let possible = 0;
  for (const mark of marks) {
    const subject = subjects.get(mark.subjectId);
    if (!subject) continue;
    const result = grouped.get(mark.subjectId) ?? {
      subjectId: mark.subjectId, subjectNameEn: subject.nameEn,
      subjectNameAm: subject.nameAm, assessmentCount: 0,
      students: new Set(), earned: 0, possible: 0
    };
    result.assessmentCount += 1;
    result.students.add(mark.studentId);
    result.earned += Number(mark.value);
    result.possible += Number(mark.maxValue);
    allStudents.add(mark.studentId);
    earned += Number(mark.value);
    possible += Number(mark.maxValue);
    grouped.set(mark.subjectId, result);
  }
  return {
    termId: term.id, termName: term.name, status: 'provisional',
    totals: termMarksMetric({
      assessmentCount: marks.length, students: allStudents.size,
      earned, possible
    }),
    bySubject: [...grouped.values()].map((result) => ({
      subjectId: result.subjectId, subjectNameEn: result.subjectNameEn,
      subjectNameAm: result.subjectNameAm, ...termMarksMetric({
        assessmentCount: result.assessmentCount, students: result.students.size,
        earned: result.earned, possible: result.possible
      })
    }))
      .sort((a, b) => a.subjectNameEn.localeCompare(b.subjectNameEn))
  };
}

export function termMarksMetric(result) {
  const earnedPoints = roundScore(Number(result.earned) || 0);
  const possiblePoints = roundScore(Number(result.possible) || 0);
  return {
    assessmentCount: Number(result.assessmentCount) || 0,
    students: Number(result.students) || 0,
    earnedPoints, possiblePoints,
    percent: possiblePoints ? Math.round((earnedPoints / possiblePoints) * 10000) / 100 : null
  };
}

export function bandForPercent(bands, percent) {
  const band = [...bands].sort((a, b) => b.minPercent - a.minPercent)
    .find((item) => percent >= item.minPercent);
  return band ? { code: band.code, nameEn: band.nameEn, nameAm: band.nameAm } : null;
}

export function roundScore(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function markFingerprint(marks) {
  const rows = marks.map((mark) => ({
    id: mark.id, assessmentName: mark.assessmentName ?? mark.assessment_name,
    value: Number(mark.value), maxValue: Number(mark.maxValue ?? mark.max_value),
    state: mark.state
  })).sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(stableJson(rows)).digest('hex');
}

export function mapTermReportRevision(row) {
  const snapshot = typeof row.report_json === 'string' ? JSON.parse(row.report_json) : row.report_json;
  return {
    id: row.id, campusId: row.campus_id, studentId: row.student_id, termId: row.term_id,
    revision: Number(row.revision), status: row.status, snapshot,
    amendmentReason: row.amendment_reason ?? null,
    createdBy: row.created_by, submittedBy: row.submitted_by ?? null,
    approvedBy: row.approved_by ?? null, publishedBy: row.published_by ?? null,
    createdAt: row.created_at, submittedAt: row.submitted_at ?? null,
    approvedAt: row.approved_at ?? null, publishedAt: row.published_at ?? null
  };
}

export function termReportWorkflowView(revision) {
  const iso = (value) => value ? new Date(value).toISOString() : null;
  return {
    id: revision.id, campusId: revision.campusId, studentId: revision.studentId,
    termId: revision.termId, revision: revision.revision, status: revision.status,
    amendmentReason: revision.amendmentReason ?? null,
    createdBy: revision.createdBy, submittedBy: revision.submittedBy,
    approvedBy: revision.approvedBy, publishedBy: revision.publishedBy,
    createdAt: iso(revision.createdAt), submittedAt: iso(revision.submittedAt),
    approvedAt: iso(revision.approvedAt), publishedAt: iso(revision.publishedAt),
    gradingPolicyConfirmedAt: revision.snapshot.gradingPolicyConfirmedAt,
    snapshot: revision.snapshot
  };
}

export function portalPublishedReportView(revision) {
  const { snapshot } = revision;
  return {
    revision: revision.revision, publishedAt: revision.publishedAt,
    snapshot: {
      termId: snapshot.termId, termName: snapshot.termName,
      subjects: snapshot.subjects.map((subject) => ({
        subjectId: subject.subjectId, subjectNameEn: subject.subjectNameEn,
        subjectNameAm: subject.subjectNameAm, value: subject.value,
        maxValue: subject.maxValue, percent: subject.percent, band: subject.band
      })),
      totalValue: snapshot.totalValue, totalMaxValue: snapshot.totalMaxValue,
      overallPercent: snapshot.overallPercent, overallBand: snapshot.overallBand
    }
  };
}

export function assertTermReportTransition(revision, targetState, actor, currentPolicyConfirmedAt) {
  const prior = { submitted: 'draft', approved: 'submitted', published: 'approved' }[targetState];
  if (!prior || revision.status !== prior) {
    throw reportWorkflowConflict(`A report revision must be ${prior ?? 'in the required prior state'} before it can be ${targetState}.`);
  }
  if (!currentPolicyConfirmedAt ||
    revision.snapshot.gradingPolicyConfirmedAt !== currentPolicyConfirmedAt) {
    throw reportWorkflowConflict('The grading policy changed after this report draft was created; create a fresh draft.');
  }
  if (targetState === 'approved' &&
    [revision.createdBy, revision.submittedBy].includes(actor.sub)) {
    throw reportWorkflowConflict('A report approver must differ from its creator and submitter.');
  }
  if (targetState === 'published' &&
    [revision.createdBy, revision.submittedBy, revision.approvedBy].includes(actor.sub)) {
    throw reportWorkflowConflict('A report publisher must differ from its creator, submitter and approver.');
  }
}

export function assertReportSnapshotCurrent(revision, marks) {
  if (!marks.length || marks.some((mark) => mark.state !== 'locked') ||
    markFingerprint(marks) !== revision.snapshot.sourceMarkFingerprint) {
    throw reportWorkflowConflict('Published marks changed after this report draft was created; create a fresh draft.');
  }
}

export function reportWorkflowConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'REPORT_WORKFLOW_CONFLICT';
  return error;
}

export function reportAmendmentReasonRequired() {
  const error = new Error('A reason is required to amend a published report.');
  error.status = 400;
  error.code = 'REPORT_AMENDMENT_REASON_REQUIRED';
  return error;
}

export function markAmendmentConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'MARK_AMENDMENT_CONFLICT';
  return error;
}

export function assertMarkTransition(currentState, targetState, enteredBy, actor, approvedBy = null) {
  const expectedPreviousState = {
    submitted: 'draft',
    approved: 'submitted',
    locked: 'approved'
  }[targetState];
  if (!expectedPreviousState || currentState !== expectedPreviousState) {
    const error = new Error(`A mark must be ${expectedPreviousState ?? 'in the required prior state'} before it can be ${targetState}.`);
    error.status = 409;
    error.code = 'MARK_TRANSITION_INVALID';
    throw error;
  }
  if (targetState === 'approved' && enteredBy === actor.sub) {
    const error = new Error('A mark cannot be approved by the person who entered it.');
    error.status = 409;
    error.code = 'MARK_APPROVER_MUST_DIFFER';
    throw error;
  }
  if (targetState === 'locked' && approvedBy === actor.sub) {
    const error = new Error('A mark cannot be published by the person who approved it.');
    error.status = 409;
    error.code = 'MARK_PUBLISHER_MUST_DIFFER';
    throw error;
  }
  if (targetState === 'locked' && !approvedBy) {
    const error = new Error('The mark has no recorded approver; it cannot be published until reviewed.');
    error.status = 409;
    error.code = 'MARK_APPROVER_NOT_RECORDED';
    throw error;
  }
}
