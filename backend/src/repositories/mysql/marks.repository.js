import { randomUUID } from 'node:crypto';
import {
  assertMarkTransition, assertReportSnapshotCurrent, assertTermReportTransition,
  bandForPercent, buildTermMarksSummary, markAmendmentConflict, markFingerprint,
  mapTermReportRevision, portalPublishedReportView, reportAmendmentReasonRequired,
  reportWorkflowConflict, roundScore, stableJson, termMarksMetric, termReportWorkflowView
} from '../marks.mappers.js';
import { auditRow, campusScopeError, now, setupConflict } from '../shared.js';

export const mysqlMarksBundle = {
  async saveMark(data, actor) {
    if (!await this.hasStudents(actor.activeCampusId, [data.studentId])) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [data.studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    if ((data.termId && !await this.db('terms as t')
      .join('academic_years as y', 'y.id', 't.academic_year_id')
      .where({ 't.id': data.termId, 'y.campus_id': actor.activeCampusId }).first('t.id')) ||
      (data.subjectId && !await this.db('subjects')
        .where({ id: data.subjectId, campus_id: actor.activeCampusId }).first('id'))) {
      throw campusScopeError('Term or subject is not available at this campus.');
    }
    if (data.subjectId) {
      const placement = await this.db('enrolments as e')
        .join('sections as s', 's.id', 'e.section_id')
        .join('academic_years as y', 'y.id', 'e.academic_year_id')
        .where({
          'e.student_id': data.studentId, 'e.status': 'active',
          'y.status': 'active', 's.campus_id': actor.activeCampusId
        }).first('s.grade_level_id', 's.stream');
      if (placement) {
        const gradeSubject = await this.db('grade_subjects').where({
          grade_level_id: placement.grade_level_id, subject_id: data.subjectId
        }).whereIn('stream', ['all', placement.stream ?? 'all']).first('id');
        if (!gradeSubject) throw setupConflict('This subject is not included in the student’s grade and stream.');
      }
    }
    if (Boolean(data.termId) !== Boolean(data.subjectId)) {
      const error = new Error('Select both a term and subject for report-card marks.');
      error.status = 400;
      error.code = 'MARK_CONTEXT_REQUIRED';
      throw error;
    }
    const prior = await this.db('marks').where({
      campus_id: actor.activeCampusId, client_uuid: data.clientUuid
    }).first();
    if (prior) return { id: prior.id, duplicate: true };
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('marks').insert({
          id, campus_id: actor.activeCampusId, student_id: data.studentId,
          assessment_name: data.assessmentName, max_value: data.maxValue,
          value: data.value, term_id: data.termId ?? null, subject_id: data.subjectId ?? null,
          entered_by: actor.sub, client_uuid: data.clientUuid
        });
        await trx('audit_log').insert(auditRow(actor, 'mark.created', 'mark', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        const concurrent = await this.db('marks').where({
          campus_id: actor.activeCampusId, client_uuid: data.clientUuid
        }).first();
        if (concurrent) return { id: concurrent.id, duplicate: true };
      }
      throw error;
    }
    return { id, ...data, state: 'draft' };
  },
  async transitionMark(markId, targetState, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    let updated;
    await this.db.transaction(async (trx) => {
      const query = trx('marks').where({
        id: markId, campus_id: actor.activeCampusId
      }).forUpdate();
      const row = await query.first();
      if (!row) return;
      if (accessible && (accessible.size === 0 ||
        !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [row.student_id]))) {
        throw campusScopeError('Mark is outside the assigned sections.');
      }
      assertMarkTransition(row.state, targetState, row.entered_by, actor, row.approved_by);
      const update = { state: targetState, updated_at: trx.fn.now() };
      if (targetState === 'approved') update.approved_by = actor.sub;
      if (targetState === 'locked') update.published_by = actor.sub;
      await trx('marks').where({ id: markId, campus_id: actor.activeCampusId }).update(update);
      await trx('audit_log').insert(auditRow(
        actor, `mark.${targetState}`, 'mark', markId,
        { state: row.state }, { state: targetState }
      ));
      updated = {
        id: row.id, studentId: row.student_id, assessmentName: row.assessment_name,
        maxValue: Number(row.max_value), value: Number(row.value), state: targetState,
        termId: row.term_id, subjectId: row.subject_id, enteredBy: row.entered_by,
        approvedBy: targetState === 'approved' ? actor.sub : row.approved_by,
        publishedBy: targetState === 'locked' ? actor.sub : row.published_by
      };
    });
    return updated ?? null;
  },
  async amendPublishedMark(markId, amendment, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    let updated = null;
    await this.db.transaction(async (trx) => {
      const row = await trx('marks').where({
        id: markId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return;
      if (accessible && (accessible.size === 0 ||
        !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [row.student_id]))) {
        throw campusScopeError('Mark is outside the assigned sections.');
      }
      if (row.state !== 'locked') throw markAmendmentConflict('Only a published mark can be corrected.');
      if (Number(row.value) === amendment.value && Number(row.max_value) === amendment.maxValue) {
        throw markAmendmentConflict('Enter a changed score to create a correction.');
      }
      const before = {
        value: Number(row.value), maxValue: Number(row.max_value), state: row.state,
        approvedBy: row.approved_by ?? null, publishedBy: row.published_by ?? null
      };
      await trx('marks').where({ id: markId, campus_id: actor.activeCampusId }).update({
        value: amendment.value, max_value: amendment.maxValue, state: 'draft',
        approved_by: null, published_by: null, updated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(
        actor, 'mark.amended', 'mark', markId, before, {
          value: amendment.value, maxValue: amendment.maxValue,
          state: 'draft', reason: amendment.reason
        }
      ));
      updated = {
        id: row.id, campusId: row.campus_id, studentId: row.student_id,
        assessmentName: row.assessment_name, value: amendment.value, maxValue: amendment.maxValue,
        state: 'draft', termId: row.term_id, subjectId: row.subject_id, enteredBy: row.entered_by,
        approvedBy: null, publishedBy: null
      };
    });
    return updated;
  },
  async listMarks(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    if (accessible && accessible.size === 0) return [];
    const query = this.db('marks').where({ campus_id: campusId });
    if (accessible) {
      query.whereIn('student_id', this.db('enrolments as e')
        .join('students as st', 'st.id', 'e.student_id')
        .whereIn('e.section_id', [...accessible])
        .where({ 'st.campus_id': campusId, 'e.status': 'active' })
        .select('e.student_id'));
    }
    const rows = await query.orderBy('created_at', 'desc').limit(250);
    return rows.map((r) => ({
      id: r.id, studentId: r.student_id, assessmentName: r.assessment_name,
      maxValue: Number(r.max_value), value: Number(r.value), state: r.state,
      termId: r.term_id, subjectId: r.subject_id, enteredBy: r.entered_by,
      approvedBy: r.approved_by ?? null, publishedBy: r.published_by ?? null
    }));
  },
  async getTermMarksSummary(termId, actor) {
    const term = await this.db('terms as t')
      .join('academic_years as y', 'y.id', 't.academic_year_id')
      .where({ 't.id': termId, 'y.campus_id': actor.activeCampusId })
      .first('t.id', 't.name');
    if (!term) throw campusScopeError('Term is not available at this campus.');
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && accessible.size === 0) {
      return buildTermMarksSummary({ id: term.id, name: term.name }, [], new Map());
    }
    const query = this.db('marks as m')
      .join('subjects as s', 's.id', 'm.subject_id')
      .where({
        'm.campus_id': actor.activeCampusId, 'm.term_id': termId,
        's.campus_id': actor.activeCampusId
      });
    if (accessible) {
      query.whereIn('m.student_id', this.db('enrolments as e')
        .join('students as st', 'st.id', 'e.student_id')
        .whereIn('e.section_id', [...accessible])
        .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
        .select('e.student_id'));
    }
    const aggregate = (source) => source
      .sum({ earned: 'm.value' }).sum({ possible: 'm.max_value' })
      .count({ assessmentCount: 'm.id' })
      .countDistinct({ students: 'm.student_id' });
    const totals = await aggregate(query.clone()).first();
    const rows = await aggregate(query.clone())
      .select('m.subject_id as subjectId', 's.name_en as subjectNameEn', 's.name_am as subjectNameAm')
      .groupBy('m.subject_id', 's.name_en', 's.name_am').orderBy('s.name_en');
    return {
      termId: term.id, termName: term.name, status: 'provisional',
      totals: termMarksMetric(totals),
      bySubject: rows.map((row) => ({
        subjectId: row.subjectId, subjectNameEn: row.subjectNameEn,
        subjectNameAm: row.subjectNameAm, ...termMarksMetric(row)
      }))
    };
  },
  async listGradingBands(campusId) {
    const rows = await this.db('grading_bands').where({ campus_id: campusId }).orderBy('min_percent');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, code: row.code, nameEn: row.name_en,
      nameAm: row.name_am, minPercent: Number(row.min_percent)
    }));
  },
  async getGradingPolicy(campusId) {
    const row = await this.db('campus_academic_policies').where({ campus_id: campusId }).first();
    return row ? {
      campusId: row.campus_id, scoringMethod: row.scoring_method,
      confirmedBy: row.confirmed_by,
      confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null
    } : { campusId, scoringMethod: 'points_weighted', confirmedBy: null, confirmedAt: null };
  },
  async confirmGradingPolicy(data, actor) {
    const policy = {
      campus_id: actor.activeCampusId, scoring_method: data.scoringMethod,
      confirmed_by: actor.sub, confirmed_at: now(), updated_at: now()
    };
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId }).forUpdate().first('id');
      const bands = await trx('grading_bands').where({ campus_id: actor.activeCampusId })
        .where({ min_percent: 0 }).first('id');
      if (!bands) {
        throw setupConflict('Configure a complete grading scale, including a 0% band, before confirming policy.');
      }
      const beforeRow = await trx('campus_academic_policies')
        .where({ campus_id: actor.activeCampusId }).first();
      const before = beforeRow ? {
        campusId: beforeRow.campus_id, scoringMethod: beforeRow.scoring_method,
        confirmedBy: beforeRow.confirmed_by,
        confirmedAt: beforeRow.confirmed_at ? new Date(beforeRow.confirmed_at).toISOString() : null
      } : { campusId: actor.activeCampusId, scoringMethod: 'points_weighted', confirmedBy: null, confirmedAt: null };
      await trx('campus_academic_policies').insert(policy)
        .onConflict('campus_id').merge({
          scoring_method: policy.scoring_method, confirmed_by: policy.confirmed_by,
          confirmed_at: policy.confirmed_at, updated_at: policy.updated_at
        });
      await trx('audit_log').insert(auditRow(
        actor, 'grading_policy.confirmed', 'grading_policy', actor.activeCampusId,
        before, {
          campusId: actor.activeCampusId, scoringMethod: data.scoringMethod,
          confirmedBy: actor.sub, confirmedAt: policy.confirmed_at
        }
      ));
    });
    return this.getGradingPolicy(actor.activeCampusId);
  },
  async replaceGradingBands(data, actor) {
    const before = await this.listGradingBands(actor.activeCampusId);
    const bands = data.bands.map((band) => ({
      id: randomUUID(), campus_id: actor.activeCampusId, code: band.code,
      name_en: band.nameEn, name_am: band.nameAm, min_percent: band.minPercent
    }));
    try {
      await this.db.transaction(async (trx) => {
        await trx('campuses').where({ id: actor.activeCampusId }).forUpdate().first('id');
        const policyRow = await trx('campus_academic_policies')
          .where({ campus_id: actor.activeCampusId }).first();
        const policyBefore = policyRow ? {
          campusId: policyRow.campus_id, scoringMethod: policyRow.scoring_method,
          confirmedBy: policyRow.confirmed_by,
          confirmedAt: policyRow.confirmed_at ? new Date(policyRow.confirmed_at).toISOString() : null
        } : { campusId: actor.activeCampusId, scoringMethod: 'points_weighted', confirmedBy: null, confirmedAt: null };
        await trx('grading_bands').where({ campus_id: actor.activeCampusId }).delete();
        if (bands.length) await trx('grading_bands').insert(bands);
        await trx('audit_log').insert(auditRow(
          actor, 'grading_bands.replaced', 'grading_scale', actor.activeCampusId, before, data.bands
        ));
        if (policyBefore.confirmedAt) {
          await trx('campus_academic_policies').where({ campus_id: actor.activeCampusId }).update({
            confirmed_by: null, confirmed_at: null, updated_at: trx.fn.now()
          });
          await trx('audit_log').insert(auditRow(
            actor, 'grading_policy.invalidated', 'grading_policy', actor.activeCampusId,
            policyBefore, { ...policyBefore, confirmedBy: null, confirmedAt: null }
          ));
        }
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw setupConflict('Grading band codes and minimum percentages must be unique.');
      }
      throw error;
    }
    return this.listGradingBands(actor.activeCampusId);
  },
  async getStudentReportCard(studentId, termId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) throw campusScopeError('Student is outside the active campus.');
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible) {
      const inScope = await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [studentId]);
      if (!inScope) throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    const term = await this.db('terms as t')
      .join('academic_years as y', 'y.id', 't.academic_year_id')
      .where({ 't.id': termId, 'y.campus_id': actor.activeCampusId })
      .first('t.id', 't.name');
    if (!term) throw campusScopeError('Term is not available at this campus.');
    const rows = await this.db('marks as m')
      .join('subjects as s', 's.id', 'm.subject_id')
      .where({
        'm.campus_id': actor.activeCampusId, 'm.student_id': studentId,
        'm.term_id': termId, 's.campus_id': actor.activeCampusId
      })
      .select(
        'm.id', 'm.subject_id', 's.name_en', 's.name_am',
        'm.assessment_name', 'm.value', 'm.max_value', 'm.state'
      );
    const grouped = new Map();
    const fingerprintRows = [];
    for (const row of rows) {
      fingerprintRows.push({
        id: row.id, assessmentName: row.assessment_name,
        value: Number(row.value), maxValue: Number(row.max_value), state: row.state
      });
      const current = grouped.get(row.subject_id) ?? {
        subjectId: row.subject_id, subjectNameEn: row.name_en, subjectNameAm: row.name_am,
        assessmentCount: 0, value: 0, maxValue: 0
      };
      current.assessmentCount += 1;
      current.value += Number(row.value);
      current.maxValue += Number(row.max_value);
      grouped.set(row.subject_id, current);
    }
    const bands = await this.listGradingBands(actor.activeCampusId);
    const policy = await this.getGradingPolicy(actor.activeCampusId);
    const subjects = [...grouped.values()].map((result) => {
      const value = roundScore(result.value);
      const maxValue = roundScore(result.maxValue);
      const percent = maxValue ? Math.round((value / maxValue) * 10000) / 100 : 0;
      return { ...result, value, maxValue, percent, band: bandForPercent(bands, percent) };
    });
    const totalValue = roundScore(subjects.reduce((total, result) => total + result.value, 0));
    const totalMaxValue = roundScore(subjects.reduce((total, result) => total + result.maxValue, 0));
    const overallPercent = !subjects.length ? 0
      : policy.scoringMethod === 'equal_subject_weighted'
        ? Math.round(subjects.reduce((total, result) => total + result.percent, 0) /
          subjects.length * 100) / 100
        : totalMaxValue ? Math.round((totalValue / totalMaxValue) * 10000) / 100 : 0;
    return {
      studentId, termId, termName: term.name, subjects, totalValue, totalMaxValue,
      overallPercent, overallBand: bandForPercent(bands, overallPercent), status: 'provisional',
      scoringMethod: policy.scoringMethod, gradingPolicyConfirmed: Boolean(policy.confirmedAt),
      gradingPolicyConfirmedAt: policy.confirmedAt,
      sourceMarkFingerprint: markFingerprint(fingerprintRows),
      workflow: await this.latestTermReport(studentId, termId, actor.activeCampusId)
    };
  },
  async latestTermReport(studentId, termId, campusId) {
    const row = await this.db('term_report_revisions').where({
      campus_id: campusId, student_id: studentId, term_id: termId
    }).orderBy('revision', 'desc').first();
    return row ? termReportWorkflowView(mapTermReportRevision(row)) : null;
  },
  async createTermReportDraft(studentId, termId, actor, amendmentReason = null) {
    const report = await this.getStudentReportCard(studentId, termId, actor);
    let result = null;
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId }).forUpdate().first('id');
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first('id');
      if (!student) throw campusScopeError('Student is outside the active campus.');
      const marks = await trx('marks').where({
        campus_id: actor.activeCampusId, student_id: studentId, term_id: termId
      }).whereNotNull('subject_id').forUpdate()
        .select('id', 'assessment_name', 'value', 'max_value', 'state');
      if (!marks.length || marks.some((mark) => mark.state !== 'locked')) {
        throw reportWorkflowConflict('All report-card marks must be published before creating an official report.');
      }
      if (markFingerprint(marks.map((mark) => ({
        id: mark.id, assessmentName: mark.assessment_name,
        value: Number(mark.value), maxValue: Number(mark.max_value), state: mark.state
      }))) !== report.sourceMarkFingerprint) {
        throw reportWorkflowConflict('Published marks changed while this report was being prepared; reload the preview.');
      }
      const policyRow = await trx('campus_academic_policies')
        .where({ campus_id: actor.activeCampusId }).first();
      const confirmedAt = policyRow?.confirmed_at
        ? new Date(policyRow.confirmed_at).toISOString() : null;
      if (!report.gradingPolicyConfirmed || !confirmedAt ||
        report.gradingPolicyConfirmedAt !== confirmedAt) {
        throw reportWorkflowConflict('Confirm the campus grading policy before creating an official report.');
      }
      const previousRow = await trx('term_report_revisions').where({
        campus_id: actor.activeCampusId, student_id: studentId, term_id: termId
      }).orderBy('revision', 'desc').forUpdate().first();
      const previous = previousRow ? mapTermReportRevision(previousRow) : null;
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
      await trx('term_report_revisions').insert({
        id: revision.id, campus_id: revision.campusId, student_id: studentId,
        term_id: termId, revision: revision.revision, status: revision.status,
        report_json: JSON.stringify(snapshot), created_by: actor.sub,
        amendment_reason: amendmentReason
      });
      await trx('audit_log').insert(auditRow(
        actor, 'term_report.draft_created', 'term_report_revision', revision.id, null,
        {
          studentId, termId, revision: revision.revision, status: revision.status,
          amendmentReason
        }
      ));
      result = termReportWorkflowView(revision);
    });
    return result;
  },
  async transitionTermReport(reportId, targetState, actor) {
    let result = null;
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId }).forUpdate().first('id');
      const row = await trx('term_report_revisions').where({
        id: reportId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return;
      const revision = mapTermReportRevision(row);
      const currentMarks = await trx('marks').where({
        campus_id: actor.activeCampusId, student_id: revision.studentId, term_id: revision.termId
      }).whereNotNull('subject_id').forUpdate()
        .select('id', 'assessment_name', 'value', 'max_value', 'state');
      assertReportSnapshotCurrent(revision, currentMarks.map((mark) => ({
        id: mark.id, assessmentName: mark.assessment_name,
        value: Number(mark.value), maxValue: Number(mark.max_value), state: mark.state
      })));
      const policyRow = await trx('campus_academic_policies')
        .where({ campus_id: actor.activeCampusId }).first();
      const confirmedAt = policyRow?.confirmed_at
        ? new Date(policyRow.confirmed_at).toISOString() : null;
      assertTermReportTransition(revision, targetState, actor, confirmedAt);
      const timestampColumn = {
        submitted: 'submitted_at', approved: 'approved_at', published: 'published_at'
      }[targetState];
      const actorColumn = {
        submitted: 'submitted_by', approved: 'approved_by', published: 'published_by'
      }[targetState];
      await trx('term_report_revisions').where({ id: reportId }).update({
        status: targetState, [timestampColumn]: trx.fn.now(), [actorColumn]: actor.sub,
        updated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(
        actor, `term_report.${targetState}`, 'term_report_revision', reportId,
        { status: revision.status }, { status: targetState, revision: revision.revision }
      ));
      const transitioned = { ...revision, status: targetState };
      if (targetState === 'submitted') {
        transitioned.submittedBy = actor.sub;
        transitioned.submittedAt = new Date().toISOString();
      } else if (targetState === 'approved') {
        transitioned.approvedBy = actor.sub;
        transitioned.approvedAt = new Date().toISOString();
      } else {
        transitioned.publishedBy = actor.sub;
        transitioned.publishedAt = new Date().toISOString();
      }
      result = termReportWorkflowView(transitioned);
    });
    return result;
  }
};
