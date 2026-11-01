import { mapStudent } from '../students.mappers.js';
import { mapTermReportRevision, portalPublishedReportView } from '../marks.mappers.js';
import { portalStudentView } from '../portal.mappers.js';

export const mysqlPortalBundle = {
  async verifyStudentGuardian(studentId, guardianId, access, actor) {
    return this.db.transaction(async (trx) => {
      const link = await trx('student_guardians as sg')
        .join('students as s', 's.id', 'sg.student_id')
        .where({
          'sg.student_id': studentId, 'sg.guardian_id': guardianId,
          's.campus_id': actor.activeCampusId
        }).whereNull('s.archived_at')
        .select('sg.is_verified', 'sg.can_view_results', 'sg.can_view_fees').first();
      if (!link) return null;
      await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).update({
        is_verified: access.isVerified, can_view_results: access.canViewResults, can_view_fees: access.canViewFees
      });
      await trx('audit_log').insert(auditRow(actor, 'student.guardian_access_updated', 'student_guardian',
        studentId, {
          isVerified: Boolean(link.is_verified), canViewResults: Boolean(link.can_view_results),
          canViewFees: Boolean(link.can_view_fees)
        }, { guardianId, ...access }));
      return { studentId, guardianId, ...access };
    });
  },
  async getPortalHome(actor) {
    if (actor.role === 'student') {
      const rows = await this.db('students').where({
        user_id: actor.sub, campus_id: actor.activeCampusId, status: 'enrolled'
      }).whereNull('archived_at').select('id', 'campus_id', 'student_no', 'given_name_en',
        'father_name_en', 'grandfather_name_en', 'given_name_am', 'father_name_am',
        'grandfather_name_am', 'section_name', 'status');
      const students = await Promise.all(rows.map(async (row) => ({
        student: portalStudentView(mapStudent(row)), canViewResults: true, canViewFees: false,
        results: await this.portalResults(row.id),
        reports: await this.portalPublishedReports(row.id, row.campus_id),
        attendance: await this.portalAttendance(row.id, row.campus_id), fees: []
      })));
      return { role: actor.role, students };
    }
    if (actor.role === 'parent_guardian') {
      const rows = await this.db('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .join('students as s', 's.id', 'sg.student_id')
        .whereIn('s.campus_id', actor.campusIds)
        .where({
          'g.user_id': actor.sub, 'g.organization_id': actor.orgId, 'sg.is_verified': true
        }).whereNull('s.archived_at')
        .select('s.id', 's.campus_id', 's.student_no', 's.given_name_en', 's.father_name_en',
          's.grandfather_name_en', 's.given_name_am', 's.father_name_am',
          's.grandfather_name_am', 's.section_name', 's.status', 'sg.can_view_results', 'sg.can_view_fees');
      const students = await Promise.all(rows.map(async (row) => {
        const canViewResults = Boolean(row.can_view_results);
        const canViewFees = Boolean(row.can_view_fees);
        return {
          student: portalStudentView(mapStudent(row)), canViewResults, canViewFees,
          results: canViewResults ? await this.portalResults(row.id) : [],
          reports: canViewResults ? await this.portalPublishedReports(row.id, row.campus_id) : [],
          attendance: await this.portalAttendance(row.id, row.campus_id),
          fees: canViewFees ? await this.portalFees(row.id) : []
        };
      }));
      return { role: actor.role, students };
    }
    return { role: actor.role, students: [] };
  },
  async portalResults(studentId) {
    const rows = await this.db('marks').where({ student_id: studentId, state: 'locked' })
      .orderBy('created_at', 'desc').limit(20);
    return rows.map((row) => ({
      assessmentName: row.assessment_name, value: Number(row.value), maxValue: Number(row.max_value)
    }));
  },
  async portalPublishedReports(studentId, campusId) {
    const rows = await this.db('term_report_revisions').where({
      student_id: studentId, campus_id: campusId, status: 'published'
    }).orderBy('published_at', 'desc').orderBy('revision', 'desc').limit(20);
    return rows.map((row) => portalPublishedReportView(mapTermReportRevision(row)));
  },
  async portalFees(studentId) {
    const rows = await this.db('invoices').where({ student_id: studentId })
      .whereNot({ status: 'void' }).orderBy('issued_at', 'desc').limit(20);
    return rows.map((row) => ({
      invoiceNumber: row.invoice_number, totalAmount: Number(row.total_amount),
      dueDate: row.due_date, status: row.status, currencyCode: row.currency_code
    }));
  },
  async portalAttendance(studentId, campusId) {
    const rows = await this.db('attendance_sessions as s')
      .join('attendance_records as r', 'r.session_id', 's.id')
      .where({ 's.campus_id': campusId, 'r.student_id': studentId })
      .orderBy('s.attendance_date', 'desc').limit(20)
      .select('s.attendance_date', 'r.status');
    return rows.map((row) => ({
      date: String(row.attendance_date).slice(0, 10), status: row.status
    }));
  }
};
