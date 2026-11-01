import { randomUUID } from 'node:crypto';
import {
  attendanceCorrectionConflict, attendanceCorrectionWindowOpen, buildAttendanceSummary
} from '../attendance.mappers.js';
import { campusScopeError, now } from '../shared.js';
import { studentName } from '../students.mappers.js';

export const memoryAttendanceBundle = {
  async hasSection(campusId, sectionId) {
    return this.sections.some((section) => section.campusId === campusId && section.id === sectionId && section.isActive);
  },
  async hasStudentsInSection(campusId, sectionId, ids) {
    const section = this.sections.find((item) => item.campusId === campusId && item.id === sectionId && item.isActive);
    if (!section) return false;
    const found = this.students.filter((student) =>
      student.campusId === campusId && student.sectionName === section.name && ids.includes(student.id));
    return found.length === ids.length;
  },
  async listRoster(actor, sectionId) {
    const section = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive);
    const accessible = await this.accessibleSectionIds(actor);
    if (!section || (accessible && !accessible.has(sectionId))) throw campusScopeError('Section is not accessible.');
    return (await this.listStudents(actor.activeCampusId))
      .filter((student) => student.sectionName === section.name);
  },
  async saveAttendance(data, actor) {
    const existing = this.attendance.find((item) =>
      item.campusId === actor.activeCampusId && item.clientUuid === data.clientUuid);
    if (existing) return { ...existing, duplicate: true };
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
    const session = {
      id: randomUUID(), campusId: actor.activeCampusId, date: data.date,
      sectionId: data.sectionId, clientUuid: data.clientUuid,
      records: data.records, takenBy: actor.sub, createdAt: now()
    };
    this.attendance.unshift(session);
    try {
      await this.appendAudit(actor, 'attendance.recorded', 'attendance_session', session.id, null, session);
    } catch (error) {
      const index = this.attendance.indexOf(session);
      if (index >= 0) this.attendance.splice(index, 1);
      throw error;
    }
    return session;
  },
  async listAttendance(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    return this.attendance.filter((item) => item.campusId === campusId &&
      (accessible === null || accessible.has(item.sectionId)));
  },
  async getAttendanceSession(sessionId, actor) {
    const session = this.attendance.find((item) =>
      item.id === sessionId && item.campusId === actor.activeCampusId);
    if (!session) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !accessible.has(session.sectionId)) {
      throw campusScopeError('Attendance session is outside the assigned sections.');
    }
    return {
      id: session.id, date: session.date, sectionId: session.sectionId,
      records: (session.records ?? []).map((record) => {
        const student = this.students.find((item) => item.id === record.studentId);
        return {
          studentId: record.studentId,
          studentName: student ? studentName(student) : '',
          status: record.status, reason: record.reason ?? ''
        };
      })
    };
  },
  async correctAttendance(sessionId, studentId, correction, actor) {
    const session = this.attendance.find((item) =>
      item.id === sessionId && item.campusId === actor.activeCampusId);
    if (!session) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !accessible.has(session.sectionId)) {
      throw campusScopeError('Attendance session is outside the assigned sections.');
    }
    const record = (session.records ?? []).find((item) => item.studentId === studentId);
    if (!record) return null;
    if (record.status === correction.status) {
      const error = new Error('Choose a different attendance status to make a correction.');
      error.status = 409;
      error.code = 'ATTENDANCE_CORRECTION_NO_CHANGE';
      throw error;
    }
    if (!attendanceCorrectionWindowOpen(session.date)) {
      if (this.attendanceCorrectionRequests.some((item) =>
        item.campusId === actor.activeCampusId && item.sessionId === sessionId &&
        item.studentId === studentId && item.status === 'pending')) {
        throw attendanceCorrectionConflict('A correction request is already pending for this attendance record.');
      }
      const request = {
        id: randomUUID(), campusId: actor.activeCampusId, sessionId, studentId,
        attendanceDate: session.date, originalStatus: record.status,
        requestedStatus: correction.status, reason: correction.reason,
        requestedBy: actor.sub, status: 'pending', requestedAt: now(),
        reviewedBy: null, reviewNote: null, reviewedAt: null
      };
      this.attendanceCorrectionRequests.unshift(request);
      await this.appendAudit(actor, 'attendance.correction_requested',
        'attendance_correction_request', request.id, null, {
          sessionId, studentId, attendanceDate: session.date,
          originalStatus: record.status, requestedStatus: correction.status,
          reason: correction.reason
        });
      return { approvalRequired: true, request: { ...request } };
    }
    const before = { status: record.status, reason: record.reason ?? '' };
    record.status = correction.status;
    record.reason = correction.reason;
    await this.appendAudit(actor, 'attendance.corrected', 'attendance_record',
      sessionId, before, { status: record.status, reason: correction.reason });
    return this.getAttendanceSession(sessionId, actor);
  },
  async listAttendanceCorrectionRequests(actor) {
    return this.attendanceCorrectionRequests.filter((item) =>
      item.campusId === actor.activeCampusId && item.status === 'pending')
      .map((item) => ({
        ...item,
        studentName: studentName(this.students.find((student) => student.id === item.studentId) ?? {})
      }));
  },
  async reviewAttendanceCorrection(requestId, review, actor) {
    const item = this.attendanceCorrectionRequests.find((request) =>
      request.id === requestId && request.campusId === actor.activeCampusId);
    if (!item) return null;
    if (item.status !== 'pending') {
      throw attendanceCorrectionConflict('Only pending attendance correction requests can be reviewed.');
    }
    if (item.requestedBy === actor.sub) {
      throw attendanceCorrectionConflict('A correction requester cannot approve or reject their own request.');
    }
    const session = this.attendance.find((entry) =>
      entry.id === item.sessionId && entry.campusId === actor.activeCampusId);
    const record = session?.records.find((entry) => entry.studentId === item.studentId);
    if (!session || !record) return null;
    if (review.decision === 'approved' && record.status !== item.originalStatus) {
      throw attendanceCorrectionConflict('Attendance changed after this correction was requested; review the current record.');
    }
    const before = { status: item.status };
    item.status = review.decision;
    item.reviewedBy = actor.sub;
    item.reviewNote = review.note;
    item.reviewedAt = now();
    if (review.decision === 'approved') {
      const attendanceBefore = { status: record.status, reason: record.reason ?? '' };
      record.status = item.requestedStatus;
      record.reason = item.reason;
      await this.appendAudit(actor, 'attendance.corrected', 'attendance_record',
        item.sessionId, attendanceBefore, {
          status: record.status, reason: item.reason, correctionRequestId: item.id
        });
    }
    await this.appendAudit(actor, `attendance.correction_${review.decision}`,
      'attendance_correction_request', item.id, before, {
        status: item.status, reviewedBy: item.reviewedBy, reviewNote: item.reviewNote
      });
    return { ...item };
  },
  async getAttendanceSummary(campusId, from, to, actor) {
    const accessible = await this.accessibleSectionIds(actor);
    const sections = new Map(this.sections.filter((section) => section.campusId === campusId)
      .map((section) => [section.id, section.name]));
    const rows = this.attendance.filter((session) =>
      session.campusId === campusId && session.date >= from && session.date <= to &&
      (accessible === null || accessible.has(session.sectionId)))
      .flatMap((session) => (session.records ?? []).map((record) => ({
        sessionId: session.id, date: session.date, sectionId: session.sectionId,
        sectionName: sections.get(session.sectionId) ?? '', status: record.status
      })));
    return buildAttendanceSummary(rows, from, to);
  }
};
