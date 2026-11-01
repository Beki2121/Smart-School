export function portalStudentView(student) {
  return {
    id: student.id, campusId: student.campusId, studentNo: student.studentNo,
    name: `${student.givenNameEn} ${student.fatherNameEn} ${student.grandfatherNameEn}`,
    nameAm: `${student.givenNameAm} ${student.fatherNameAm} ${student.grandfatherNameAm}`,
    sectionName: student.sectionName, status: student.status
  };
}
