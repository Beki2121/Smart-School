import { randomUUID } from 'node:crypto';
import {
  assertMarkTransition, assertReportSnapshotCurrent, assertTermReportTransition,
  bandForPercent, buildTermMarksSummary, markAmendmentConflict, markFingerprint,
  mapTermReportRevision, portalPublishedReportView, reportAmendmentReasonRequired,
  reportWorkflowConflict, roundScore, stableJson, termMarksMetric, termReportWorkflowView
} from '../marks.mappers.js';
import { campusScopeError, now, setupConflict } from '../shared.js';
import { calculateWeightedResult } from '../exams.mappers.js';

export const memoryMarksBundle = {
  async saveMark(data, actor) {
    const exam = await this.resolveExamForMark(data, actor);
    data = {
      ...data, examId: exam.id, termId: exam.termId ?? data.termId,
      subjectId: exam.subjectId ?? data.subjectId,
      maxValue: exam.isLegacy ? data.maxValue : exam.maxValue,
      assessmentName: exam.isLegacy ? data.assessmentName : exam.title
    };
    if (!exam.isLegacy) {
      const student = this.students.find((item) =>
        item.id === data.studentId && item.campusId === actor.activeCampusId);
      const section = this.sections.find((item) =>
        item.campusId === actor.activeCampusId && item.name === student?.sectionName);
      if (!this.examScheduleEntries.some((entry) =>
        entry.examId === exam.id && entry.sectionId === section?.id)) {
        throw campusScopeError('Student is not in a section scheduled for this exam.');
      }
      if (this.marks.some((mark) => mark.examId === exam.id && mark.studentId === data.studentId)) {
        throw setupConflict('A mark already exists for this student and exam.');
      }
    }
    if (exam.gradeLevelId) {
      const student = this.students.find((item) =>
        item.id === data.studentId && item.campusId === actor.activeCampusId);
      const studentSection = this.sections.find((item) =>
        item.campusId === actor.activeCampusId && item.name === student?.sectionName);
      if (studentSection?.gradeLevelId !== exam.gradeLevelId) {
        throw campusScopeError('Student is outside the exam grade.');
      }
    }
    if (!await this.hasStudents(actor.activeCampusId, [data.studentId])) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [data.studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    if ((data.termId && !this.academicYears.some((year) =>
      year.campusId === actor.activeCampusId && year.terms?.some((term) => term.id === data.termId))) ||
      (data.subjectId && !this.subjects.some((subject) =>
        subject.id === data.subjectId && subject.campusId === actor.activeCampusId))) {
      throw campusScopeError('Term or subject is not available at this campus.');
    }
    const student = this.students.find((item) =>
      item.id === data.studentId && item.campusId === actor.activeCampusId);
    const studentSection = this.sections.find((item) =>
      item.campusId === actor.activeCampusId && item.name === student?.sectionName);
    if (data.subjectId && studentSection &&
        this.gradeSubjects.some((item) => item.gradeLevelId === studentSection.gradeLevelId) &&
        !await this.sectionHasSubject(studentSection, data.subjectId)) {
      throw setupConflict('This subject is not included in the student’s grade and stream.');
    }
    if (Boolean(data.termId) !== Boolean(data.subjectId)) {
      const error = new Error('Select both a term and subject for report-card marks.');
      error.status = 400;
      error.code = 'MARK_CONTEXT_REQUIRED';
      throw error;
    }
    const existing = this.marks.find((item) =>
      item.campusId === actor.activeCampusId && item.clientUuid === data.clientUuid);
    if (existing) return { ...existing, duplicate: true };
    const mark = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, state: 'draft',
      enteredBy: actor.sub, createdAt: now()
    };
    this.marks.unshift(mark);
    await this.appendAudit(actor, 'mark.created', 'mark', mark.id, null, mark);
    return mark;
  },
  async transitionMark(markId, targetState, actor) {
    const mark = this.marks.find((item) =>
      item.id === markId && item.campusId === actor.activeCampusId);
    if (!mark) return null;
    const accessible = await this.listMarks(actor.activeCampusId, actor);
    if (!accessible.some((item) => item.id === markId)) {
      throw campusScopeError('Mark is outside the assigned sections.');
    }
    assertMarkTransition(mark.state, targetState, mark.enteredBy, actor, mark.approvedBy);
    const before = { state: mark.state };
    mark.state = targetState;
    if (targetState === 'approved') mark.approvedBy = actor.sub;
    if (targetState === 'locked') mark.publishedBy = actor.sub;
    await this.appendAudit(actor, `mark.${targetState}`, 'mark', mark.id, before, { state: targetState });
    await this.updateExamStatusFromMarks(mark.examId, actor);
    return mark;
  },
  async amendPublishedMark(markId, amendment, actor) {
    const mark = this.marks.find((item) =>
      item.id === markId && item.campusId === actor.activeCampusId);
    if (!mark) return null;
    const accessible = await this.listMarks(actor.activeCampusId, actor);
    if (!accessible.some((item) => item.id === markId)) {
      throw campusScopeError('Mark is outside the assigned sections.');
    }
    if (mark.state !== 'locked') throw markAmendmentConflict('Only a published mark can be corrected.');
    if (mark.value === amendment.value && mark.maxValue === amendment.maxValue) {
      throw markAmendmentConflict('Enter a changed score to create a correction.');
    }
    const before = {
      value: mark.value, maxValue: mark.maxValue, state: mark.state,
      approvedBy: mark.approvedBy ?? null, publishedBy: mark.publishedBy ?? null
    };
    mark.value = amendment.value;
    mark.maxValue = amendment.maxValue;
    mark.state = 'draft';
    mark.approvedBy = null;
    mark.publishedBy = null;
    await this.appendAudit(actor, 'mark.amended', 'mark', mark.id, before, {
      value: mark.value, maxValue: mark.maxValue, state: mark.state, reason: amendment.reason
    });
    return mark;
  },
  async listMarks(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    if (accessible === null) return this.marks.filter((item) => item.campusId === campusId);
    const sectionNames = new Set(this.sections.filter((section) => accessible.has(section.id)).map((section) => section.name));
    return this.marks.filter((item) => item.campusId === campusId &&
      sectionNames.has(this.students.find((student) => student.id === item.studentId)?.sectionName));
  },
  async getTermMarksSummary(termId, actor) {
    const term = (await this.listTerms(actor.activeCampusId)).find((item) => item.id === termId);
    if (!term) throw campusScopeError('Term is not available at this campus.');
    const subjects = new Map(this.subjects.filter((item) => item.campusId === actor.activeCampusId)
      .map((item) => [item.id, item]));
    const marks = (await this.listMarks(actor.activeCampusId, actor)).filter((item) =>
      item.termId === termId && item.subjectId && subjects.has(item.subjectId));
    return buildTermMarksSummary(term, marks, subjects);
  },
  async listGradingBands(campusId) {
    return this.gradingBands.filter((band) => band.campusId === campusId)
      .sort((a, b) => a.minPercent - b.minPercent);
  },
  async getGradingPolicy(campusId) {
    return this.gradingPolicies.find((item) => item.campusId === campusId) ?? {
      campusId, scoringMethod: 'points_weighted', confirmedBy: null, confirmedAt: null
    };
  },
  async confirmGradingPolicy(data, actor) {
    const bands = await this.listGradingBands(actor.activeCampusId);
    if (!bands.length || !bands.some((band) => band.minPercent === 0)) {
      throw setupConflict('Configure a complete grading scale, including a 0% band, before confirming policy.');
    }
    const before = await this.getGradingPolicy(actor.activeCampusId);
    const policy = {
      campusId: actor.activeCampusId, scoringMethod: data.scoringMethod,
      confirmedBy: actor.sub, confirmedAt: now()
    };
    this.gradingPolicies = this.gradingPolicies.filter((item) => item.campusId !== actor.activeCampusId)
      .concat(policy);
    await this.appendAudit(actor, 'grading_policy.confirmed', 'grading_policy', actor.activeCampusId,
      before, policy);
    return policy;
  },
  latestTermReport(studentId, termId, campusId) {
    const revision = this.termReportRevisions.filter((item) =>
      item.studentId === studentId && item.termId === termId && item.campusId === campusId)
      .sort((a, b) => b.revision - a.revision)[0];
    return revision ? termReportWorkflowView(revision) : null;
  },
  async createTermReportDraft(studentId, termId, actor, amendmentReason = null) {
    const report = await this.getStudentReportCard(studentId, termId, actor);
    if (report.missingExamCount) {
      throw reportWorkflowConflict('All scheduled exams must be published before creating an official report.');
    }
    if (!report.gradingPolicyConfirmed) {
      throw reportWorkflowConflict('Confirm the campus grading policy before creating an official report.');
    }
    const marks = this.marks.filter((mark) =>
      mark.campusId === actor.activeCampusId && mark.studentId === studentId &&
      mark.termId === termId && mark.subjectId);
    if (!marks.length || marks.some((mark) => mark.state !== 'locked')) {
      throw reportWorkflowConflict('All report-card marks must be published before creating an official report.');
    }
    const previous = this.termReportRevisions.filter((item) =>
      item.campusId === actor.activeCampusId && item.studentId === studentId && item.termId === termId)
      .sort((a, b) => b.revision - a.revision)[0];
    const snapshot = { ...report };
    delete snapshot.workflow;
    if (previous?.status !== 'published' &&
      previous?.snapshot.gradingPolicyConfirmedAt === report.gradingPolicyConfirmedAt &&
      previous?.snapshot.sourceMarkFingerprint === report.sourceMarkFingerprint) {
      throw reportWorkflowConflict('The current report revision must be published before another draft is created.');
    }
    if (previous?.status === 'published' && stableJson(previous.snapshot) === stableJson(snapshot)) {
      throw reportWorkflowConflict('There are no report-card changes to publish as a new revision.');
    }
    if (previous?.status === 'published' && !amendmentReason) {
      throw reportAmendmentReasonRequired();
    }
    const revision = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId, termId,
      revision: (previous?.revision ?? 0) + 1, status: 'draft', snapshot,
      amendmentReason,
      createdBy: actor.sub, submittedBy: null, approvedBy: null, publishedBy: null,
      createdAt: now(), submittedAt: null, approvedAt: null, publishedAt: null
    };
    this.termReportRevisions.push(revision);
    await this.appendAudit(actor, 'term_report.draft_created', 'term_report_revision', revision.id,
      null, {
        studentId, termId, revision: revision.revision, status: revision.status,
        amendmentReason
      });
    return termReportWorkflowView(revision);
  },
  async transitionTermReport(reportId, targetState, actor) {
    const revision = this.termReportRevisions.find((item) =>
      item.id === reportId && item.campusId === actor.activeCampusId);
    if (!revision) return null;
    const policy = await this.getGradingPolicy(actor.activeCampusId);
    assertTermReportTransition(revision, targetState, actor, policy.confirmedAt);
    const currentMarks = this.marks.filter((mark) =>
      mark.campusId === actor.activeCampusId && mark.studentId === revision.studentId &&
      mark.termId === revision.termId && mark.subjectId);
    assertReportSnapshotCurrent(revision, currentMarks);
    const before = { status: revision.status };
    revision.status = targetState;
    if (targetState === 'submitted') {
      revision.submittedBy = actor.sub;
      revision.submittedAt = now();
    } else if (targetState === 'approved') {
      revision.approvedBy = actor.sub;
      revision.approvedAt = now();
    } else {
      revision.publishedBy = actor.sub;
      revision.publishedAt = now();
    }
    await this.appendAudit(actor, `term_report.${targetState}`, 'term_report_revision',
      revision.id, before, { status: targetState, revision: revision.revision });
    return termReportWorkflowView(revision);
  },
  async replaceGradingBands(data, actor) {
    const before = await this.listGradingBands(actor.activeCampusId);
    const policyBefore = await this.getGradingPolicy(actor.activeCampusId);
    const bands = data.bands.map((band) => ({
      id: randomUUID(), campusId: actor.activeCampusId, ...band
    }));
    this.gradingBands = this.gradingBands.filter((band) => band.campusId !== actor.activeCampusId)
      .concat(bands);
    this.gradingPolicies = this.gradingPolicies.map((policy) => policy.campusId === actor.activeCampusId
      ? { ...policy, confirmedBy: null, confirmedAt: null } : policy);
    await this.appendAudit(actor, 'grading_bands.replaced', 'grading_scale', actor.activeCampusId, before, bands);
    if (policyBefore.confirmedAt) {
      await this.appendAudit(actor, 'grading_policy.invalidated', 'grading_policy', actor.activeCampusId,
        policyBefore, await this.getGradingPolicy(actor.activeCampusId));
    }
    return bands;
  },
  async getStudentReportCard(studentId, termId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId);
    if (!student) throw campusScopeError('Student is outside the active campus.');
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    const term = (await this.listTerms(actor.activeCampusId)).find((item) => item.id === termId);
    if (!term) throw campusScopeError('Term is not available at this campus.');
    const bands = await this.listGradingBands(actor.activeCampusId);
    const policy = await this.getGradingPolicy(actor.activeCampusId);
    const marks = (await this.listMarks(actor.activeCampusId, actor)).filter((mark) =>
      mark.studentId === studentId && mark.termId === termId && mark.subjectId);
    const studentSection = this.sections.find((section) =>
      section.campusId === actor.activeCampusId && section.name === student.sectionName);
    const termExams = this.exams.filter((exam) =>
      exam.campusId === actor.activeCampusId && exam.termId === termId && !exam.isLegacy &&
      this.examScheduleEntries.some((entry) =>
        entry.examId === exam.id && entry.sectionId === studentSection?.id));
    const examResults = new Map();
    for (const subjectId of new Set(termExams.map((exam) => exam.subjectId))) {
      const exams = termExams.filter((exam) => exam.subjectId === subjectId);
      const marksByExamId = new Map(this.marks.filter((mark) =>
        mark.studentId === studentId && mark.state === 'locked' &&
        exams.some((exam) => exam.id === mark.examId))
        .map((mark) => [mark.examId, mark]));
      examResults.set(subjectId, calculateWeightedResult(exams, marksByExamId));
    }
    const subjectResults = this.subjects.filter((subject) =>
      subject.campusId === actor.activeCampusId &&
      (marks.some((mark) => mark.subjectId === subject.id) || examResults.has(subject.id)))
      .map((subject) => {
        const weighted = examResults.get(subject.id);
        if (weighted) {
          const value = weighted.scoreBasisPoints / 100;
          return {
            subjectId: subject.id, subjectNameEn: subject.nameEn, subjectNameAm: subject.nameAm,
            assessmentCount: termExams.filter((exam) => exam.subjectId === subject.id).length,
            value, maxValue: 100, percent: value, band: bandForPercent(bands, value),
            calculationBasis: weighted.basis
          };
        }
        const subjectMarks = marks.filter((mark) => mark.subjectId === subject.id);
        const value = roundScore(subjectMarks.reduce((total, mark) => total + mark.value, 0));
        const maxValue = roundScore(subjectMarks.reduce((total, mark) => total + mark.maxValue, 0));
        const percent = maxValue ? Math.round((value / maxValue) * 10000) / 100 : 0;
        return { subjectId: subject.id, subjectNameEn: subject.nameEn, subjectNameAm: subject.nameAm,
          assessmentCount: subjectMarks.length, value, maxValue, percent, band: bandForPercent(bands, percent) };
      });
    const totalValue = roundScore(subjectResults.reduce((total, result) => total + result.value, 0));
    const totalMaxValue = roundScore(subjectResults.reduce((total, result) => total + result.maxValue, 0));
    const overallPercent = !subjectResults.length ? 0
      : policy.scoringMethod === 'equal_subject_weighted'
        ? Math.round(subjectResults.reduce((total, result) => total + result.percent, 0) /
          subjectResults.length * 100) / 100
        : totalMaxValue ? Math.round((totalValue / totalMaxValue) * 10000) / 100 : 0;
    return {
      studentId, termId, termName: term.name, subjects: subjectResults,
      totalValue, totalMaxValue, overallPercent,
      overallBand: bandForPercent(bands, overallPercent),
      status: 'provisional', scoringMethod: policy.scoringMethod,
      gradingPolicyConfirmed: Boolean(policy.confirmedAt),
      gradingPolicyConfirmedAt: policy.confirmedAt,
      missingExamCount: [...examResults.values()].reduce((total, result) =>
        total + result.missingExamCount, 0),
      calculationBasis: {
        method: 'weighted_exam_definitions',
        rounding: 'Integer basis points; round half up at score and weighted-contribution steps.',
        subjects: [...examResults.entries()].map(([subjectId, result]) => ({
          subjectId, exams: result.basis
        }))
      },
      sourceMarkFingerprint: markFingerprint(marks),
      workflow: this.latestTermReport(studentId, termId, actor.activeCampusId)
    };
  }
};
