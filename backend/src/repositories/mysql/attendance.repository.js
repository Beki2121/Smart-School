import { randomUUID } from 'node:crypto';
import {
  attendanceCorrectionConflict, attendanceCorrectionWindowOpen, buildAttendanceSummary
} from '../attendance.mappers.js';
import { auditRow, campusScopeError } from '../shared.js';
import { mapStudent, studentName } from '../students.mappers.js';

export const mysqlAttendanceBundle = {
  async hasSection(campusId, sectionId) {
    return Boolean(await this.db('sections as s').join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({ 's.campus_id': campusId, 's.id': sectionId, 'y.status': 'active' }).first());
  },
  async hasStudentsInSection(campusId, sectionId, ids) {
    const rows = await this.db('enrolments as e')
      .join('students as st', 'st.id', 'e.student_id')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .where({
        'st.campus_id': campusId, 'e.section_id': sectionId,
        'e.status': 'active', 'y.status': 'active'
      })
      .whereIn('st.id', ids)
      .countDistinct({ total: 'st.id' }).first();
    return Number(rows.total) === ids.length;
  },
  async listRoster(actor, sectionId) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !accessible.has(sectionId)) throw campusScopeError('Section is not accessible.');
    const section = await this.db('sections as s')
      .join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({ 's.id': sectionId, 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
      .first('s.id');
    if (!section) throw campusScopeError('Section is not accessible.');
    const rows = await this.db('enrolments as e')
      .join('students as st', 'st.id', 'e.student_id')
      .where({
        'st.campus_id': actor.activeCampusId, 'e.section_id': sectionId, 'e.status': 'active'
      }).whereNull('st.archived_at').select('st.*').orderBy('st.given_name_en').limit(500);
    return rows.map(mapStudent);
  },
  async saveAttendance(data, actor) {
    const prior = await this.db('attendance_sessions').where({
      campus_id: actor.activeCampusId, client_uuid: data.clientUuid
    }).first();
    if (prior) return { id: prior.id, duplicate: true };
    if (!await this.hasSection(actor.activeCampusId, data.sectionId)) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessibleSections = await this.accessibleSectionIds(actor);
    if (accessibleSections && !accessibleSections.has(data.sectionId)) {
      throw campusScopeError('Teacher is not assigned to this section.');
    }
    if (!await this.hasStudentsInSection(actor.activeCampusId, data.sectionId, data.records.map((r) => r.studentId))) {
      const error = new Error('Attendance includes a student outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('attendance_sessions').insert({
          id, campus_id: actor.activeCampusId, section_id: data.sectionId,
          attendance_date: data.date, taken_by: actor.sub, client_uuid: data.clientUuid
        });
        for (const record of data.records) {
          await trx('attendance_records').insert({
            session_id: id, student_id: record.studentId, status: record.status
          });
        }
        await trx('audit_log').insert(auditRow(actor, 'attendance.recorded', 'attendance_session', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        const concurrent = await this.db('attendance_sessions').where({
          campus_id: actor.activeCampusId, client_uuid: data.clientUuid
        }).first();
        if (concurrent) return { id: concurrent.id, duplicate: true };
      }
      throw error;
    }
    return { id, ...data };
  },
  async listAttendance(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    if (accessible && accessible.size === 0) return [];
    const query = this.db('attendance_sessions').where({ campus_id: campusId });
    if (accessible) query.whereIn('section_id', [...accessible]);
    const rows = await query
      .orderBy('attendance_date', 'desc').limit(100);
    return rows.map((r) => ({ id: r.id, date: String(r.attendance_date).slice(0, 10), sectionId: r.section_id, clientUuid: r.client_uuid }));
  },
  async getAttendanceSession(sessionId, actor) {
    const session = await this.db('attendance_sessions').where({
      id: sessionId, campus_id: actor.activeCampusId
    }).first('id', 'attendance_date', 'section_id');
    if (!session) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !accessible.has(session.section_id)) {
      throw campusScopeError('Attendance session is outside the assigned sections.');
    }
    const records = await this.db('attendance_records as r')
      .join('students as st', 'st.id', 'r.student_id')
      .where({ 'r.session_id': sessionId, 'st.campus_id': actor.activeCampusId })
      .select('r.student_id', 'r.status', 'r.reason', 'st.given_name_en',
        'st.father_name_en', 'st.grandfather_name_en')
      .orderBy('st.given_name_en').orderBy('st.father_name_en');
    return {
      id: session.id, date: String(session.attendance_date).slice(0, 10),
      sectionId: session.section_id,
      records: records.map((record) => ({
        studentId: record.student_id,
        studentName: studentName({
          givenNameEn: record.given_name_en,
          fatherNameEn: record.father_name_en,
          grandfatherNameEn: record.grandfather_name_en
        }),
        status: record.status, reason: record.reason ?? ''
      }))
    };
  },
  async correctAttendance(sessionId, studentId, correction, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    let updated = false;
    let correctionRequest = null;
    await this.db.transaction(async (trx) => {
      const session = await trx('attendance_sessions').where({
        id: sessionId, campus_id: actor.activeCampusId
      }).forUpdate().first('id', 'attendance_date', 'section_id');
      if (!session) return;
      if (accessible && !accessible.has(session.section_id)) {
        throw campusScopeError('Attendance session is outside the assigned sections.');
      }
      const record = await trx('attendance_records as r')
        .join('students as st', 'st.id', 'r.student_id')
        .where({
          'r.session_id': sessionId, 'r.student_id': studentId,
          'st.campus_id': actor.activeCampusId
        }).forUpdate().first('r.status', 'r.reason');
      if (!record) return;
      if (record.status === correction.status) {
        const error = new Error('Choose a different attendance status to make a correction.');
        error.status = 409;
        error.code = 'ATTENDANCE_CORRECTION_NO_CHANGE';
        throw error;
      }
      const attendanceDate = String(session.attendance_date).slice(0, 10);
      if (!attendanceCorrectionWindowOpen(attendanceDate)) {
        const existing = await trx('attendance_correction_requests').where({
          campus_id: actor.activeCampusId, session_id: sessionId,
          student_id: studentId, status: 'pending'
        }).forUpdate().first('id');
        if (existing) {
          throw attendanceCorrectionConflict('A correction request is already pending for this attendance record.');
        }
        const request = {
          id: randomUUID(), campus_id: actor.activeCampusId, session_id: sessionId,
          student_id: studentId, original_status: record.status,
          requested_status: correction.status, reason: correction.reason,
          requested_by: actor.sub, status: 'pending'
        };
        await trx('attendance_correction_requests').insert(request);
        await trx('audit_log').insert(auditRow(
          actor, 'attendance.correction_requested', 'attendance_correction_request',
          request.id, null, {
            sessionId, studentId, attendanceDate, originalStatus: record.status,
            requestedStatus: correction.status, reason: correction.reason
          }
        ));
        correctionRequest = {
          id: request.id, campusId: request.campus_id, sessionId: request.session_id,
          studentId: request.student_id, attendanceDate, originalStatus: request.original_status,
          requestedStatus: request.requested_status, reason: request.reason,
          requestedBy: request.requested_by, status: request.status,
          requestedAt: null, reviewedBy: null, reviewNote: null, reviewedAt: null
        };
        return;
      }
      await trx('attendance_records').where({
        session_id: sessionId, student_id: studentId
      }).update({ status: correction.status, reason: correction.reason });
      await trx('audit_log').insert(auditRow(
        actor, 'attendance.corrected', 'attendance_record', sessionId,
        { status: record.status, reason: record.reason ?? '' },
        { status: correction.status, reason: correction.reason }
      ));
      updated = true;
    });
    if (correctionRequest) {
      return { approvalRequired: true, request: correctionRequest };
    }
    return updated ? this.getAttendanceSession(sessionId, actor) : null;
  },
  async listAttendanceCorrectionRequests(actor) {
    const rows = await this.db('attendance_correction_requests as cr')
      .join('students as st', 'st.id', 'cr.student_id')
      .join('attendance_sessions as ats', 'ats.id', 'cr.session_id')
      .where({
        'cr.campus_id': actor.activeCampusId, 'cr.status': 'pending',
        'st.campus_id': actor.activeCampusId
      }).whereNull('st.archived_at')
      .select(
        'cr.id', 'cr.campus_id', 'cr.session_id', 'cr.student_id',
        'cr.original_status', 'cr.requested_status', 'cr.reason',
        'cr.requested_by', 'cr.status', 'cr.created_at', 'ats.attendance_date',
        'st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en'
      ).orderBy('cr.created_at').limit(200);
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, sessionId: row.session_id,
      studentId: row.student_id, originalStatus: row.original_status,
      requestedStatus: row.requested_status, reason: row.reason,
      requestedBy: row.requested_by, status: row.status,
      attendanceDate: String(row.attendance_date).slice(0, 10),
      requestedAt: row.created_at, studentName: studentName({
        givenNameEn: row.given_name_en, fatherNameEn: row.father_name_en,
        grandfatherNameEn: row.grandfather_name_en
      })
    }));
  },
  async reviewAttendanceCorrection(requestId, review, actor) {
    let reviewed = null;
    await this.db.transaction(async (trx) => {
      const requestRef = await trx('attendance_correction_requests').where({
        id: requestId, campus_id: actor.activeCampusId
      }).first('id', 'session_id');
      if (!requestRef) return;
      const session = await trx('attendance_sessions').where({
        id: requestRef.session_id, campus_id: actor.activeCampusId
      }).forUpdate().first('id');
      if (!session) return;
      const request = await trx('attendance_correction_requests').where({
        id: requestId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!request) return;
      if (request.status !== 'pending') {
        throw attendanceCorrectionConflict('Only pending attendance correction requests can be reviewed.');
      }
      if (request.requested_by === actor.sub) {
        throw attendanceCorrectionConflict('A correction requester cannot approve or reject their own request.');
      }
      const record = await trx('attendance_records').where({
        session_id: request.session_id, student_id: request.student_id
      }).forUpdate().first('status', 'reason');
      if (!record) return;
      if (review.decision === 'approved' && record.status !== request.original_status) {
        throw attendanceCorrectionConflict('Attendance changed after this correction was requested; review the current record.');
      }
      if (review.decision === 'approved') {
        await trx('attendance_records').where({
          session_id: request.session_id, student_id: request.student_id
        }).update({ status: request.requested_status, reason: request.reason });
        await trx('audit_log').insert(auditRow(
          actor, 'attendance.corrected', 'attendance_record',
          request.session_id,
          { status: record.status, reason: record.reason ?? '' },
          { status: request.requested_status, reason: request.reason,
            correctionRequestId: request.id }
        ));
      }
      await trx('attendance_correction_requests').where({ id: request.id }).update({
        status: review.decision, reviewed_by: actor.sub,
        review_note: review.note, reviewed_at: trx.fn.now(), updated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(
        actor, `attendance.correction_${review.decision}`, 'attendance_correction_request',
        request.id, { status: request.status }, {
          status: review.decision, reviewedBy: actor.sub, reviewNote: review.note
        }
      ));
      reviewed = {
        id: request.id, campusId: request.campus_id, sessionId: request.session_id,
        studentId: request.student_id, originalStatus: request.original_status,
        requestedStatus: request.requested_status, reason: request.reason,
        requestedBy: request.requested_by, status: review.decision,
        reviewedBy: actor.sub, reviewNote: review.note
      };
    });
    return reviewed;
  },
  async getAttendanceSummary(campusId, from, to, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    const query = this.db('attendance_sessions as s')
      .join('attendance_records as r', 'r.session_id', 's.id')
      .join('sections as c', 'c.id', 's.section_id')
      .where({ 's.campus_id': campusId })
      .whereBetween('s.attendance_date', [from, to])
      .select(
        's.id as session_id', 's.attendance_date as date', 's.section_id',
        'c.name as section_name', 'r.status'
      );
    if (accessible) {
      if (!accessible.size) return buildAttendanceSummary([], from, to);
      query.whereIn('s.section_id', [...accessible]);
    }
    const rows = await query.orderBy('s.attendance_date').orderBy('c.name');
    return buildAttendanceSummary(rows.map((row) => ({
      sessionId: row.session_id, date: String(row.date).slice(0, 10),
      sectionId: row.section_id, sectionName: row.section_name, status: row.status
    })), from, to);
  }
};
