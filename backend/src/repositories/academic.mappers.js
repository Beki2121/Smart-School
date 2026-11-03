function dateOnly(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function mapAcademicYear(row) {
  return {
    id: row.id, campusId: row.campus_id, labelEc: row.label_ec,
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date), status: row.status
  };
}

export function mapSchoolCalendarEntry(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId ?? null,
    entryType: row.entry_type ?? row.entryType,
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    startDate: dateOnly(row.start_date ?? row.startDate),
    endDate: dateOnly(row.end_date ?? row.endDate),
    isNonInstructionalDay: Boolean(row.is_non_instructional_day ?? row.isNonInstructionalDay),
    notesEn: row.notes_en ?? row.notesEn ?? '', notesAm: row.notes_am ?? row.notesAm ?? '',
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

export function mapCurriculumUnit(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId,
    gradeLevelId: row.grade_level_id ?? row.gradeLevelId,
    subjectId: row.subject_id ?? row.subjectId, stream: row.stream,
    unitNumber: Number(row.unit_number ?? row.unitNumber),
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    learningOutcomesEn: row.learning_outcomes_en ?? row.learningOutcomesEn,
    learningOutcomesAm: row.learning_outcomes_am ?? row.learningOutcomesAm,
    plannedStart: row.planned_start ?? row.plannedStart ?? null,
    plannedEnd: row.planned_end ?? row.plannedEnd ?? null,
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

export function mapLessonPlan(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId,
    teachingAssignmentId: row.teaching_assignment_id ?? row.teachingAssignmentId,
    curriculumUnitId: row.curriculum_unit_id ?? row.curriculumUnitId ?? null,
    plannedOn: String(row.planned_on ?? row.plannedOn).slice(0, 10),
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    objectivesEn: row.objectives_en ?? row.objectivesEn,
    objectivesAm: row.objectives_am ?? row.objectivesAm,
    activitiesEn: row.activities_en ?? row.activitiesEn,
    activitiesAm: row.activities_am ?? row.activitiesAm,
    resources: row.resources ?? '',
    status: row.status, sectionId: row.section_id ?? row.sectionId ?? null,
    sectionName: row.section_name ?? row.sectionName ?? '',
    subjectId: row.subject_id ?? row.subjectId ?? null,
    subjectName: row.subject_name ?? row.subjectName ?? '',
    teacherName: row.teacher_name ?? row.teacherName ?? '',
    unitName: row.unit_name ?? row.unitName ?? '',
    createdBy: row.created_by ?? row.createdBy ?? null,
    completedAt: row.completed_at ?? row.completedAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

export function mapPromotionRule(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId,
    gradeLevelId: row.grade_level_id ?? row.gradeLevelId,
    minimumAnnualPercent: Number(row.minimum_annual_percent ?? row.minimumAnnualPercent),
    maximumFailedRequiredSubjects: Number(row.maximum_failed_required_subjects ?? row.maximumFailedRequiredSubjects),
    updatedBy: row.updated_by ?? row.updatedBy ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}
