import { portalPublishedReportView } from '../marks.mappers.js';
import { portalStudentView } from '../portal.mappers.js';

export const memoryPortalBundle = {
  async verifyStudentGuardian(studentId, guardianId, access, actor) {
    const student = this.students.find((item) => item.id === studentId &&
      item.campusId === actor.activeCampusId && !item.archivedAt);
    const link = this.studentGuardians.find((item) =>
      item.studentId === studentId && item.guardianId === guardianId);
    if (!student || !link) return null;
    const before = { isVerified: link.isVerified, canViewResults: link.canViewResults, canViewFees: link.canViewFees };
    Object.assign(link, { isVerified: access.isVerified, canViewResults: access.canViewResults, canViewFees: access.canViewFees });
    await this.appendAudit(actor, 'student.guardian_access_updated', 'student_guardian', studentId, before, {
      guardianId, ...access
    });
    return { ...link };
  },
  async getPortalHome(actor) {
    if (actor.role === 'student') {
      const student = this.students.find((item) => item.userId === actor.sub &&
        item.campusId === actor.activeCampusId && !item.archivedAt);
      return {
        role: actor.role,
        students: student ? [{
          student: portalStudentView(student), canViewResults: true, canViewFees: false,
          results: this.portalResults(student.id),
          reports: this.portalPublishedReports(student.id, student.campusId),
          attendance: this.portalAttendance(student.id, student.campusId), fees: []
        }] : []
      };
    }
    if (actor.role === 'parent_guardian') {
      const guardian = this.guardians.find((item) => item.userId === actor.sub && item.orgId === actor.orgId);
      if (!guardian) return { role: actor.role, students: [] };
      const students = this.studentGuardians.filter((link) => link.guardianId === guardian.id && link.isVerified)
        .map((link) => this.students.find((student) =>
          student.id === link.studentId && !student.archivedAt &&
          (actor.campusIds ?? []).includes(student.campusId)) && ({
          student: portalStudentView(this.students.find((student) => student.id === link.studentId)),
          canViewResults: Boolean(link.canViewResults), canViewFees: Boolean(link.canViewFees),
          results: link.canViewResults ? this.portalResults(link.studentId) : [],
          reports: link.canViewResults
            ? this.portalPublishedReports(link.studentId, this.students.find((student) =>
              student.id === link.studentId)?.campusId) : [],
          attendance: this.portalAttendance(link.studentId, actor.activeCampusId),
          fees: link.canViewFees ? this.portalFees(link.studentId) : []
        })).filter(Boolean);
      return { role: actor.role, students };
    }
    return { role: actor.role, students: [] };
  },
  portalResults(studentId) {
    return this.marks.filter((item) => item.studentId === studentId && item.state === 'locked')
      .slice(-20).reverse().map((item) => ({
        assessmentName: item.assessmentName, value: item.value, maxValue: item.maxValue
      }));
  },
  portalPublishedReports(studentId, campusId) {
    return this.termReportRevisions.filter((item) =>
      item.studentId === studentId && item.campusId === campusId && item.status === 'published')
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
      .slice(0, 20).map(portalPublishedReportView);
  },
  portalFees(studentId) {
    return this.feeInvoices.filter((item) => item.studentId === studentId && item.status !== 'void')
      .slice(-20).reverse().map((item) => ({
        invoiceNumber: item.invoiceNumber, totalAmount: item.totalAmount,
        dueDate: item.dueDate, status: item.status, currencyCode: item.currencyCode
      }));
  },
  portalAttendance(studentId, campusId) {
    return this.attendance.flatMap((session) => {
      if (session.campusId !== campusId) return [];
      return (session.records ?? [])
        .filter((record) => record.studentId === studentId)
        .map((record) => ({ date: session.date, status: record.status }));
    })
      .slice(-20).reverse();
  }
};
