export function mapStaff(row, extra = {}) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    userId: row.user_id ?? row.userId ?? null,
    departmentId: row.department_id ?? row.departmentId ?? null,
    givenNameEn: row.given_name_en ?? row.givenNameEn,
    fatherNameEn: row.father_name_en ?? row.fatherNameEn,
    grandfatherNameEn: row.grandfather_name_en ?? row.grandfatherNameEn,
    givenNameAm: row.given_name_am ?? row.givenNameAm,
    fatherNameAm: row.father_name_am ?? row.fatherNameAm,
    grandfatherNameAm: row.grandfather_name_am ?? row.grandfatherNameAm,
    jobTitle: row.job_title ?? row.jobTitle,
    qualification: row.qualification ?? '',
    employmentStatus: row.employment_status ?? row.employmentStatus,
    hiredOn: row.hired_on ?? row.hiredOn ?? null,
    name: formatStaffName(row),
    ...extra
  };
}

export function formatStaffName(staff) {
  return staff ? [staff.given_name_en ?? staff.givenNameEn, staff.father_name_en ?? staff.fatherNameEn,
    staff.grandfather_name_en ?? staff.grandfatherNameEn].filter(Boolean).join(' ') : '';
}

export function mapStaffAttendance(row) {
  return {
    id: row.id, staffId: row.staff_id ?? row.staffId,
    date: String(row.attendance_date ?? row.date).slice(0, 10),
    status: row.status, clockIn: row.clock_in ?? row.clockIn ?? null,
    clockOut: row.clock_out ?? row.clockOut ?? null
  };
}

export function mapLeaveRequest(row) {
  return {
    id: row.id, organizationId: row.organization_id ?? row.organizationId ?? null,
    campusId: row.campus_id ?? row.campusId,
    staffId: row.staff_id ?? row.staffId,
    startDate: String(row.start_date ?? row.startDate).slice(0, 10),
    endDate: String(row.end_date ?? row.endDate).slice(0, 10),
    reason: row.reason, status: row.status,
    reviewedBy: row.reviewed_by ?? row.reviewedBy ?? null,
    reviewNote: row.review_note ?? row.reviewNote ?? '',
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
    leaveTypeId: row.leave_type_id ?? row.leaveTypeId ?? null,
    requestedHalfDays: row.requested_half_days ?? row.requestedHalfDays ?? null,
    staffName: row.staffName ?? formatStaffName(row)
  };
}
