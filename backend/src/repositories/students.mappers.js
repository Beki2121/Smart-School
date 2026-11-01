export function studentName(student) {
  return `${student.givenNameEn} ${student.fatherNameEn} ${student.grandfatherNameEn}`.trim();
}

export function mapStudent(row) {
  return {
    id: row.id, campusId: row.campus_id, studentNo: row.student_no,
    givenNameAm: row.given_name_am, fatherNameAm: row.father_name_am,
    grandfatherNameAm: row.grandfather_name_am, givenNameEn: row.given_name_en,
    fatherNameEn: row.father_name_en, grandfatherNameEn: row.grandfather_name_en,
    gender: row.gender, sectionName: row.section_name ?? row.sectionName ?? '',
    sectionId: row.section_id ?? row.sectionId ?? null,
    gradeLevelId: row.grade_level_id ?? row.gradeLevelId ?? null, stream: row.stream ?? null,
    status: row.status,
    dateOfBirth: row.date_of_birth ?? row.dateOfBirth ?? null,
    previousSchool: row.previous_school ?? row.previousSchool ?? null,
    guardianPhone: row.guardian_phone ?? row.guardianPhone ?? null,
    hasPortalAccount: Boolean(row.user_id ?? row.userId)
  };
}
