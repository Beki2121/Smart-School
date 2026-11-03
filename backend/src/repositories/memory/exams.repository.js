import { randomUUID } from 'node:crypto';
import { auditRow, campusScopeError, now, setupConflict } from '../shared.js';
import { calculateWeightedResult, examConflict, examWeightConflict, nextExamStatus } from '../exams.mappers.js';

function dateKey(value) {
  return String(value).slice(0, 10);
}

function intervalsOverlap(left, right) {
  return dateKey(left.examDate) === dateKey(right.examDate) &&
    left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

function mapType(type) {
  return {
    id: type.id, organizationId: type.organizationId, code: type.code, name: type.name,
    weightBasisPoints: type.weightBasisPoints, weightPercent: type.weightBasisPoints / 100,
    isActive: type.isActive
  };
}

function mapEntry(entry, exam, sections, rooms, staff, invigilators) {
  return {
    id: entry.id, examId: entry.examId, examTitle: exam.title, status: exam.status,
    sectionId: entry.sectionId,
    sectionName: sections.find((section) => section.id === entry.sectionId)?.name ?? '',
    examDate: dateKey(entry.examDate), startsAt: entry.startsAt, endsAt: entry.endsAt,
    roomId: entry.roomId,
    roomName: rooms.find((room) => room.id === entry.roomId)?.name ?? null,
    invigilatorIds: invigilators.filter((item) => item.scheduleEntryId === entry.id)
      .map((item) => item.staffId),
    invigilators: invigilators.filter((item) => item.scheduleEntryId === entry.id)
      .map((item) => staff.find((member) => member.id === item.staffId)?.name ?? '')
      .filter(Boolean)
  };
}

export const memoryExamsBundle = {
  async listExamTypes(campusId) {
    const campus = this.campuses.find((item) => item.id === campusId);
    return this.examTypes.filter((item) =>
      item.organizationId === campus?.organizationId).map(mapType);
  },

  async createExamType(data, actor) {
    if (this.examTypes.some((item) =>
      item.organizationId === actor.orgId && item.code === data.code)) {
      throw setupConflict('An exam type with this code already exists.');
    }
    const item = {
      id: randomUUID(), organizationId: actor.orgId, code: data.code,
      name: data.name, weightBasisPoints: Math.round(data.weightPercent * 100),
      isActive: true, createdAt: now()
    };
    this.examTypes.push(item);
    await this.appendAudit(actor, 'exam_type.created', 'exam_type', item.id, null, mapType(item));
    return mapType(item);
  },

  async updateExamType(id, data, actor) {
    const item = this.examTypes.find((type) =>
      type.id === id && type.organizationId === actor.orgId);
    if (!item) return null;
    const before = mapType(item);
    if (data.weightPercent !== undefined) {
      const exams = this.exams.filter((exam) => exam.examTypeId === id && !exam.isLegacy);
      if (exams.some((exam) => this.marks.some((mark) =>
        mark.examId === exam.id && mark.state !== 'draft'))) {
        throw setupConflict('Exam type weight cannot change after marks have been submitted.');
      }
      const nextWeight = Math.round(data.weightPercent * 100);
      for (const exam of exams) {
        const examBefore = { weightBasisPoints: exam.weightBasisPoints };
        exam.weightBasisPoints = nextWeight;
        await this.appendAudit(actor, 'exam.weight_updated', 'exam', exam.id, examBefore, {
          weightBasisPoints: nextWeight
        });
      }
    }
    if (data.name !== undefined) item.name = data.name;
    if (data.weightPercent !== undefined) item.weightBasisPoints = Math.round(data.weightPercent * 100);
    if (data.isActive !== undefined) item.isActive = data.isActive;
    await this.appendAudit(actor, 'exam_type.updated', 'exam_type', id, before, mapType(item));
    return mapType(item);
  },

  async listExams(actor, { termId } = {}) {
    let rows = this.exams.filter((exam) =>
      exam.campusId === actor.activeCampusId && (!termId || exam.termId === termId));
    let visibleSectionIds = null;
    if (['student', 'parent_guardian'].includes(actor.role)) {
      const studentIds = actor.role === 'student'
        ? this.students.filter((student) => student.userId === actor.sub &&
          student.campusId === actor.activeCampusId && student.status === 'enrolled' &&
          !student.archivedAt).map((student) => student.id)
        : this.studentGuardians.filter((link) => {
          const guardian = this.guardians.find((item) => item.id === link.guardianId);
          return guardian?.userId === actor.sub && guardian.orgId === actor.orgId && link.isVerified;
        }).map((link) => link.studentId);
      const studentSections = new Set(this.students.filter((student) => studentIds.includes(student.id))
        .filter((student) => student.campusId === actor.activeCampusId &&
          (actor.campusIds ?? []).includes(student.campusId))
        .map((student) => this.sections.find((section) =>
          section.campusId === student.campusId && section.name === student.sectionName)?.id)
        .filter(Boolean));
      visibleSectionIds = studentSections;
      const publishedIds = new Set(this.examScheduleEntries.filter((entry) =>
        entry.campusId === actor.activeCampusId && studentSections.has(entry.sectionId))
        .map((entry) => entry.examId));
      rows = rows.filter((exam) => exam.schedulePublishedAt && publishedIds.has(exam.id));
    } else {
      const accessible = await this.accessibleSectionIds(actor);
      if (accessible) {
        visibleSectionIds = accessible;
        const scheduled = new Set(this.examScheduleEntries.filter((entry) =>
          entry.campusId === actor.activeCampusId && accessible.has(entry.sectionId))
          .map((entry) => entry.examId));
        rows = rows.filter((exam) => exam.schedulePublishedAt && scheduled.has(exam.id));
      }
    }
    return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((exam) => ({
        ...exam,
        examType: this.examTypes.find((type) => type.id === exam.examTypeId)?.name ?? '',
        scheduleEntries: this.examScheduleEntries.filter((entry) => entry.examId === exam.id &&
          (!visibleSectionIds || visibleSectionIds.has(entry.sectionId)))
          .map((entry) => mapEntry(entry, exam, this.sections, this.rooms, this.staff, this.examInvigilators))
      }));
  },

  async createExam(data, actor) {
    const campus = this.campuses.find((item) =>
      item.id === actor.activeCampusId && item.organizationId === actor.orgId);
    const type = this.examTypes.find((item) =>
      item.id === data.examTypeId && item.organizationId === actor.orgId && item.isActive);
    const year = this.academicYears.find((item) =>
      item.campusId === actor.activeCampusId && item.terms?.some((term) => term.id === data.termId));
    const term = year?.terms?.find((item) => item.id === data.termId);
    const grade = this.gradeLevels.find((item) =>
      item.id === data.gradeLevelId && item.campusId === actor.activeCampusId);
    const subject = this.subjects.find((item) =>
      item.id === data.subjectId && item.campusId === actor.activeCampusId);
    if (!campus || !type || !year || !grade || !subject) {
      throw campusScopeError('Exam context must belong to the active school and campus.');
    }
    if (this.gradeSubjects.some((item) => item.gradeLevelId === grade.id) &&
        !this.gradeSubjects.some((item) => item.gradeLevelId === grade.id &&
          item.subjectId === subject.id && ['all', 'natural_science', 'social_science'].includes(item.stream))) {
      throw setupConflict('This subject is not configured for the selected grade.');
    }
    if (this.exams.some((exam) => exam.campusId === campus.id &&
      exam.termId === data.termId && exam.gradeLevelId === data.gradeLevelId &&
      exam.subjectId === data.subjectId && exam.examTypeId === type.id)) {
      throw setupConflict('An exam already exists for this term, grade, subject and type.');
    }
    const scheduleInputs = data.scheduleEntries ?? [];
    const exam = {
      id: randomUUID(), organizationId: actor.orgId, campusId: campus.id,
      academicYearId: year.id, termId: data.termId, gradeLevelId: grade.id,
      subjectId: subject.id, examTypeId: type.id, title: data.title,
      weightBasisPoints: type.weightBasisPoints, maxValue: data.maxValue ?? 100,
      status: scheduleInputs.length ? 'scheduled' : 'draft', isLegacy: false, createdBy: actor.sub,
      schedulePublishedAt: null, marksOpenedAt: null, createdAt: now()
    };
    const entries = scheduleInputs.map((entry) => ({
      id: randomUUID(), organizationId: actor.orgId, campusId: campus.id,
      examId: exam.id, sectionId: entry.sectionId, examDate: entry.examDate,
      startsAt: entry.startsAt, endsAt: entry.endsAt, roomId: entry.roomId ?? null,
      createdAt: now()
    }));
    for (const entry of entries) {
      const section = this.sections.find((item) =>
        item.id === entry.sectionId && item.campusId === campus.id &&
        item.gradeLevelId === grade.id && item.academicYearId === year.id &&
        item.isActive !== false);
      const room = entry.roomId && this.rooms.find((item) =>
        item.id === entry.roomId && item.campusId === campus.id && item.isActive !== false);
      const invigilatorIds = scheduleInputs.find((input) =>
        input.sectionId === entry.sectionId && dateKey(input.examDate) === dateKey(entry.examDate))
        ?.invigilatorIds ?? [];
      const staffIds = invigilatorIds.map((staffId) => this.staff.find((member) =>
        member.id === staffId && member.campusId === campus.id && !member.archivedAt)?.id);
      if (!section || (entry.roomId && !room) || staffIds.some((id) => !id)) {
        throw campusScopeError('Schedule sections, rooms and invigilators must belong to the active campus.');
      }
      if (term?.startDate && (dateKey(entry.examDate) < dateKey(term.startDate) ||
          dateKey(entry.examDate) > dateKey(term.endDate))) {
        throw setupConflict('Exam schedule dates must fall within the selected term.');
      }
    }
    const conflicts = [];
    for (const entry of entries) {
      const inputs = scheduleInputs.find((input) =>
        input.sectionId === entry.sectionId && dateKey(input.examDate) === dateKey(entry.examDate));
      const invigilatorIds = inputs?.invigilatorIds ?? [];
      for (const existing of this.examScheduleEntries.filter((item) =>
        item.campusId === campus.id && intervalsOverlap(item, entry))) {
        const clashingInvigilators = this.examInvigilators.filter((item) =>
          item.scheduleEntryId === existing.id && invigilatorIds.includes(item.staffId));
        if (existing.sectionId === entry.sectionId || (entry.roomId && existing.roomId === entry.roomId) ||
            clashingInvigilators.length) {
          const examForEntry = this.exams.find((item) => item.id === existing.examId);
          conflicts.push({
            ...mapEntry(existing, examForEntry, this.sections, this.rooms, this.staff, this.examInvigilators),
            conflictReason: existing.sectionId === entry.sectionId ? 'section'
              : entry.roomId && existing.roomId === entry.roomId ? 'room' : 'invigilator'
          });
        }
      }
    }
    for (let index = 0; index < entries.length; index += 1) {
      const current = entries[index];
      const currentInput = scheduleInputs[index];
      for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
        const prior = entries[priorIndex];
        const priorInput = scheduleInputs[priorIndex];
        if (!intervalsOverlap(current, prior)) continue;
        const sameInvigilator = (currentInput.invigilatorIds ?? [])
          .some((staffId) => (priorInput.invigilatorIds ?? []).includes(staffId));
        if (current.sectionId === prior.sectionId ||
            (current.roomId && current.roomId === prior.roomId) || sameInvigilator) {
          conflicts.push({
            id: prior.id, examId: exam.id, examTitle: exam.title,
            sectionId: prior.sectionId, examDate: dateKey(prior.examDate),
            startsAt: prior.startsAt, endsAt: prior.endsAt,
            conflictReason: current.sectionId === prior.sectionId ? 'section'
              : current.roomId && current.roomId === prior.roomId ? 'room' : 'invigilator'
          });
        }
      }
    }
    if (conflicts.length) throw examConflict(conflicts);

    this.exams.push(exam);
    for (const entry of entries) {
      this.examScheduleEntries.push(entry);
      const input = scheduleInputs.find((item) =>
        item.sectionId === entry.sectionId && dateKey(item.examDate) === dateKey(entry.examDate));
      for (const staffId of input?.invigilatorIds ?? []) {
        this.examInvigilators.push({ scheduleEntryId: entry.id, staffId, campusId: campus.id });
      }
    }
    await this.appendAudit(actor, 'exam.created', 'exam', exam.id, null, {
      ...exam, scheduleEntries: entries
    });
    return exam;
  },

  async addExamScheduleEntry(examId, input, actor) {
    const exam = this.exams.find((item) =>
      item.id === examId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && !item.isLegacy);
    if (!exam) return null;
    if (!['draft', 'scheduled'].includes(exam.status)) {
      throw setupConflict('Schedule entries can only be added to a draft or scheduled exam.');
    }

    const section = this.sections.find((item) =>
      item.id === input.sectionId && item.campusId === exam.campusId &&
      item.gradeLevelId === exam.gradeLevelId && item.academicYearId === exam.academicYearId &&
      item.isActive !== false);
    const room = input.roomId && this.rooms.find((item) =>
      item.id === input.roomId && item.campusId === exam.campusId && item.isActive !== false);
    const staffIds = (input.invigilatorIds ?? []).map((staffId) =>
      this.staff.find((member) => member.id === staffId &&
        member.campusId === exam.campusId && !member.archivedAt)?.id);
    if (!section || (input.roomId && !room) || staffIds.some((id) => !id)) {
      throw campusScopeError('Schedule sections, rooms and invigilators must belong to the active campus.');
    }
    const year = this.academicYears.find((item) => item.id === exam.academicYearId);
    const term = year?.terms?.find((item) => item.id === exam.termId);
    const schedule = {
      id: randomUUID(), organizationId: exam.organizationId, campusId: exam.campusId,
      examId, sectionId: section.id, examDate: input.examDate,
      startsAt: input.startsAt, endsAt: input.endsAt, roomId: input.roomId ?? null,
      createdAt: now()
    };
    if (term?.startDate && (dateKey(schedule.examDate) < dateKey(term.startDate) ||
        dateKey(schedule.examDate) > dateKey(term.endDate))) {
      throw setupConflict('Exam schedule dates must fall within the selected term.');
    }
    const duplicates = this.examScheduleEntries.some((item) =>
      item.examId === examId && item.sectionId === schedule.sectionId &&
      dateKey(item.examDate) === dateKey(schedule.examDate));
    if (duplicates) throw setupConflict('A schedule entry already exists for this section and date.');

    const invigilatorIds = input.invigilatorIds ?? [];
    const conflicts = [];
    for (const existing of this.examScheduleEntries.filter((item) =>
      item.campusId === exam.campusId && intervalsOverlap(item, schedule))) {
      const matchingInvigilator = this.examInvigilators.some((item) =>
        item.scheduleEntryId === existing.id && invigilatorIds.includes(item.staffId));
      if (existing.sectionId === schedule.sectionId ||
          (schedule.roomId && existing.roomId === schedule.roomId) || matchingInvigilator) {
        const existingExam = this.exams.find((item) => item.id === existing.examId);
        conflicts.push({
          ...mapEntry(existing, existingExam, this.sections, this.rooms, this.staff, this.examInvigilators),
          conflictReason: existing.sectionId === schedule.sectionId ? 'section'
            : schedule.roomId && existing.roomId === schedule.roomId ? 'room' : 'invigilator'
        });
      }
    }
    if (conflicts.length) throw examConflict(conflicts);

    this.examScheduleEntries.push(schedule);
    for (const staffId of invigilatorIds) {
      this.examInvigilators.push({ scheduleEntryId: schedule.id, staffId, campusId: exam.campusId });
    }
    const before = { status: exam.status };
    if (exam.status === 'draft') exam.status = 'scheduled';
    await this.appendAudit(actor, 'exam.schedule_entry_created', 'exam_schedule_entry',
      schedule.id, null, { ...schedule, invigilatorIds, examStatus: exam.status });
    if (before.status !== exam.status) {
      await this.appendAudit(actor, 'exam.scheduled', 'exam', exam.id, before, { status: exam.status });
    }
    return mapEntry(schedule, exam, this.sections, this.rooms, this.staff, this.examInvigilators);
  },

  async updateExamScheduleEntry(examId, entryId, input, actor) {
    const exam = this.exams.find((item) =>
      item.id === examId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && !item.isLegacy);
    if (!exam) return null;
    const schedule = this.examScheduleEntries.find((item) =>
      item.id === entryId && item.examId === examId && item.campusId === exam.campusId);
    if (!schedule) return null;
    if (!['scheduled', 'schedule_published', 'marks_open'].includes(exam.status)) {
      throw setupConflict('This exam schedule can no longer be edited.');
    }
    if (this.marks.some((mark) => mark.examId === examId && mark.state !== 'draft')) {
      throw setupConflict('An exam schedule cannot be edited after marks have been submitted or approved.');
    }

    const section = this.sections.find((item) =>
      item.id === input.sectionId && item.campusId === exam.campusId &&
      item.gradeLevelId === exam.gradeLevelId && item.academicYearId === exam.academicYearId &&
      item.isActive !== false);
    const room = input.roomId && this.rooms.find((item) =>
      item.id === input.roomId && item.campusId === exam.campusId && item.isActive !== false);
    const invigilatorIds = input.invigilatorIds ?? [];
    const staffIds = invigilatorIds.map((staffId) => this.staff.find((member) =>
      member.id === staffId && member.campusId === exam.campusId && !member.archivedAt)?.id);
    if (!section || (input.roomId && !room) || staffIds.some((id) => !id)) {
      throw campusScopeError('Schedule sections, rooms and invigilators must belong to the active campus.');
    }
    const year = this.academicYears.find((item) => item.id === exam.academicYearId);
    const term = year?.terms?.find((item) => item.id === exam.termId);
    const afterSchedule = {
      ...schedule, sectionId: section.id, examDate: input.examDate,
      startsAt: input.startsAt, endsAt: input.endsAt, roomId: input.roomId ?? null
    };
    if (term?.startDate && (dateKey(afterSchedule.examDate) < dateKey(term.startDate) ||
        dateKey(afterSchedule.examDate) > dateKey(term.endDate))) {
      throw setupConflict('Exam schedule dates must fall within the selected term.');
    }
    if (this.examScheduleEntries.some((item) => item.id !== entryId &&
        item.examId === examId && item.sectionId === afterSchedule.sectionId &&
        dateKey(item.examDate) === dateKey(afterSchedule.examDate))) {
      throw setupConflict('A schedule entry already exists for this section and date.');
    }

    const conflicts = [];
    for (const existing of this.examScheduleEntries.filter((item) =>
      item.id !== entryId && item.campusId === exam.campusId && intervalsOverlap(item, afterSchedule))) {
      const matchingInvigilator = this.examInvigilators.some((item) =>
        item.scheduleEntryId === existing.id && invigilatorIds.includes(item.staffId));
      if (existing.sectionId === afterSchedule.sectionId ||
          (afterSchedule.roomId && existing.roomId === afterSchedule.roomId) || matchingInvigilator) {
        const existingExam = this.exams.find((item) => item.id === existing.examId);
        conflicts.push({
          ...mapEntry(existing, existingExam, this.sections, this.rooms, this.staff, this.examInvigilators),
          conflictReason: existing.sectionId === afterSchedule.sectionId ? 'section'
            : afterSchedule.roomId && existing.roomId === afterSchedule.roomId ? 'room' : 'invigilator'
        });
      }
    }
    if (conflicts.length) throw examConflict(conflicts);

    const before = {
      sectionId: schedule.sectionId, examDate: dateKey(schedule.examDate),
      startsAt: schedule.startsAt, endsAt: schedule.endsAt, roomId: schedule.roomId,
      invigilatorIds: this.examInvigilators.filter((item) => item.scheduleEntryId === entryId)
        .map((item) => item.staffId)
    };
    Object.assign(schedule, afterSchedule);
    this.examInvigilators = this.examInvigilators.filter((item) => item.scheduleEntryId !== entryId);
    for (const staffId of invigilatorIds) {
      this.examInvigilators.push({ scheduleEntryId: entryId, staffId, campusId: exam.campusId });
    }
    const previousStatus = exam.status;
    if (['schedule_published', 'marks_open'].includes(exam.status)) {
      exam.status = 'scheduled';
      exam.schedulePublishedAt = null;
      exam.marksOpenedAt = null;
    }
    const after = {
      sectionId: schedule.sectionId, examDate: dateKey(schedule.examDate),
      startsAt: schedule.startsAt, endsAt: schedule.endsAt, roomId: schedule.roomId,
      invigilatorIds, examStatus: exam.status
    };
    await this.appendAudit(actor, 'exam.schedule_entry_updated', 'exam_schedule_entry',
      entryId, before, after);
    if (previousStatus !== exam.status) {
      await this.appendAudit(actor, 'exam.schedule_rescheduled', 'exam', exam.id,
        { status: previousStatus }, {
          status: exam.status, schedulePublishedAt: exam.schedulePublishedAt,
          marksOpenedAt: exam.marksOpenedAt
        });
    }
    return mapEntry(schedule, exam, this.sections, this.rooms, this.staff, this.examInvigilators);
  },

  async updateExam(id, data, actor) {
    const exam = this.exams.find((item) =>
      item.id === id && item.campusId === actor.activeCampusId && !item.isLegacy);
    if (!exam) return null;
    if (this.marks.some((mark) => mark.examId === id && mark.state !== 'draft')) {
      throw setupConflict('An exam cannot be edited after marks have been submitted; use the existing mark correction workflow.');
    }
    if (!['draft', 'scheduled', 'schedule_published'].includes(exam.status)) {
      throw setupConflict('This exam can no longer be edited.');
    }
    const before = { title: exam.title, maxValue: exam.maxValue };
    if (data.title !== undefined) exam.title = data.title;
    if (data.maxValue !== undefined) exam.maxValue = data.maxValue;
    await this.appendAudit(actor, 'exam.updated', 'exam', id, before, {
      title: exam.title, maxValue: exam.maxValue
    });
    return exam;
  },

  async publishExamSchedule(id, actor) {
    const exam = this.exams.find((item) =>
      item.id === id && item.campusId === actor.activeCampusId && !item.isLegacy);
    if (!exam) return null;
    if (exam.status !== 'scheduled' || !this.examScheduleEntries.some((item) => item.examId === id)) {
      throw setupConflict('Only a scheduled exam with schedule entries can be published.');
    }
    const before = { status: exam.status };
    exam.status = 'schedule_published';
    exam.schedulePublishedAt = now();
    await this.appendAudit(actor, 'exam.schedule_published', 'exam', id, before, {
      status: exam.status, schedulePublishedAt: exam.schedulePublishedAt
    });
    return exam;
  },

  async openExamMarks(id, actor) {
    const exam = this.exams.find((item) =>
      item.id === id && item.campusId === actor.activeCampusId && !item.isLegacy);
    if (!exam) return null;
    if (exam.status !== 'schedule_published') {
      throw setupConflict('Publish the exam schedule before opening marks.');
    }
    const types = this.examTypes.filter((item) =>
      item.organizationId === actor.orgId && item.isActive);
    const termTypes = types.map((item) => {
      const definedExam = this.exams.find((candidate) =>
        candidate.termId === exam.termId && candidate.gradeLevelId === exam.gradeLevelId &&
        candidate.subjectId === exam.subjectId && candidate.examTypeId === item.id && !candidate.isLegacy);
      return { ...mapType(item), configured: Boolean(definedExam), examId: definedExam?.id ?? null };
    });
    const total = termTypes.reduce((sum, item) =>
      sum + (item.configured ? this.exams.find((candidate) => candidate.id === item.examId).weightBasisPoints : 0), 0);
    if (total !== 10000 || termTypes.some((item) => !item.configured)) {
      throw examWeightConflict(termTypes, total);
    }
    const before = { status: exam.status };
    exam.status = 'marks_open';
    exam.marksOpenedAt = now();
    await this.appendAudit(actor, 'exam.marks_opened', 'exam', id, before, {
      status: exam.status, marksOpenedAt: exam.marksOpenedAt
    });
    await this.addExamNotifications(exam, 'marks_due');
    return exam;
  },

  async addExamNotifications(exam, type) {
    const recipientIds = new Set();
    if (type === 'marks_due') {
      const entries = this.examScheduleEntries.filter((item) => item.examId === exam.id);
      const sectionIds = new Set(entries.map((item) => item.sectionId));
      const staffIds = new Set(this.examInvigilators.filter((item) =>
        entries.some((entry) => entry.id === item.scheduleEntryId)).map((item) => item.staffId));
      for (const assignment of this.teachingAssignments) {
        if (assignment.campusId === exam.campusId && assignment.isActive &&
            sectionIds.has(assignment.sectionId) && assignment.subjectId === exam.subjectId) {
          staffIds.add(assignment.staffId);
        }
      }
      for (const staffId of staffIds) {
        const staff = this.staff.find((item) => item.id === staffId);
        if (staff?.userId) recipientIds.add(staff.userId);
      }
    } else {
      const sectionIds = new Set(this.examScheduleEntries.filter((item) =>
        item.examId === exam.id).map((item) => item.sectionId));
      const studentIds = new Set(this.students.filter((student) => {
        const section = this.sections.find((item) =>
          item.campusId === student.campusId && item.name === student.sectionName);
        return student.campusId === exam.campusId && student.status === 'enrolled' &&
          !student.archivedAt && sectionIds.has(section?.id);
      }).map((item) => item.id));
      for (const student of this.students.filter((item) => studentIds.has(item.id))) {
        if (student.userId) recipientIds.add(student.userId);
      }
      for (const link of this.studentGuardians.filter((item) =>
        studentIds.has(item.studentId) && item.isVerified && item.canViewResults)) {
        const guardian = this.guardians.find((item) => item.id === link.guardianId);
        if (guardian?.userId && guardian.orgId === exam.organizationId) recipientIds.add(guardian.userId);
      }
    }
    for (const recipientId of recipientIds) {
      const key = `${exam.id}:${recipientId}:${type}`;
      if (this.examNotifications.some((item) => item.key === key)) continue;
      this.examNotifications.push({
        key, organizationId: exam.organizationId, campusId: exam.campusId,
        examId: exam.id, recipientId, notificationType: type, createdAt: now()
      });
      this.userNotifications.unshift({
        id: randomUUID(), organizationId: exam.organizationId, campusId: exam.campusId,
        userId: recipientId, sourceType: `exam_${type}`, sourceId: exam.id,
        titleEn: type === 'marks_due' ? 'Marks are due' : 'Exam results published',
        titleAm: type === 'marks_due' ? 'ውጤት ማስገባት ጊዜ ደርሷል' : 'የፈተና ውጤት ታትሟል',
        bodyEn: exam.title, bodyAm: exam.title, readAt: null, createdAt: now()
      });
    }
  },

  async getExamMonitoring(actor) {
    const exams = await this.listExams(actor);
    return exams.filter((exam) => !exam.isLegacy).map((exam) => {
      const expected = this.expectedExamStudentIds(exam);
      const marked = new Set(this.marks.filter((mark) => mark.examId === exam.id)
        .map((mark) => mark.studentId));
      return {
        id: exam.id, title: exam.title, status: exam.status,
        expectedMarks: expected.size, recordedMarks: marked.size,
        missingMarks: [...expected].filter((studentId) => !marked.has(studentId)).length
      };
    });
  },

  expectedExamStudentIds(exam) {
    const sections = new Set(this.examScheduleEntries.filter((entry) =>
      entry.examId === exam.id).map((entry) => entry.sectionId));
    const ids = this.enrolments.filter((enrolment) => sections.has(enrolment.sectionId) &&
      enrolment.status === 'active' &&
      (!exam.academicYearId || enrolment.academicYearId === exam.academicYearId))
      .map((enrolment) => enrolment.studentId);
    return new Set(ids);
  },

  async updateExamStatusFromMarks(examId, actor) {
    const exam = this.exams.find((item) => item.id === examId);
    if (!exam || exam.isLegacy) return;
    const marks = this.marks.filter((item) => item.examId === examId);
    const expected = this.expectedExamStudentIds(exam).size;
    const status = nextExamStatus(exam, marks, expected);
    if (status === exam.status) return;
    const before = { status: exam.status };
    exam.status = status;
    await this.appendAudit(actor, `exam.${status}`, 'exam', exam.id, before, { status });
    if (status === 'published') await this.addExamNotifications(exam, 'results_published');
  },

  async getWeightedExamResult(studentId, termId, actor) {
    const exams = this.exams.filter((exam) =>
      exam.campusId === actor.activeCampusId && exam.termId === termId &&
      !exam.isLegacy && exam.status === 'published');
    const marksByExamId = new Map(this.marks.filter((mark) =>
      mark.studentId === studentId && mark.state === 'locked' &&
      exams.some((exam) => exam.id === mark.examId)).map((mark) => [mark.examId, mark]));
    return calculateWeightedResult(exams, marksByExamId);
  },

  async examById(id, actor) {
    return this.exams.find((item) =>
      item.id === id && item.campusId === actor.activeCampusId) ?? null;
  },

  async resolveExamForMark(data, actor) {
    if (data.examId) {
      const exam = this.exams.find((item) =>
        item.id === data.examId && item.campusId === actor.activeCampusId &&
        item.organizationId === actor.orgId);
      if (!exam) throw campusScopeError('Exam is outside the active campus.');
      if ((data.termId && data.termId !== exam.termId) ||
          (data.subjectId && data.subjectId !== exam.subjectId) ||
          Number(data.maxValue) !== exam.maxValue) {
        throw setupConflict('Mark context and maximum must match the selected exam.');
      }
      if (!exam.isLegacy && exam.status !== 'marks_open') {
        throw setupConflict('Marks can only be entered while the exam is open for marks.');
      }
      return exam;
    }
    let legacyType = this.examTypes.find((item) =>
      item.organizationId === actor.orgId && item.code === 'legacy');
    if (!legacyType) {
      legacyType = {
        id: randomUUID(), organizationId: actor.orgId, code: 'legacy',
        name: 'Legacy', weightBasisPoints: 10000, isActive: false
      };
      this.examTypes.push(legacyType);
    }
    const student = this.students.find((item) =>
      item.id === data.studentId && item.campusId === actor.activeCampusId);
    const section = this.sections.find((item) =>
      item.campusId === actor.activeCampusId && item.name === student?.sectionName);
    const year = this.academicYears.find((item) =>
      item.campusId === actor.activeCampusId && item.terms?.some((term) => term.id === data.termId));
    const gradeLevelId = section?.gradeLevelId ?? null;
    const existing = this.exams.find((item) =>
      item.campusId === actor.activeCampusId && item.isLegacy &&
      item.termId === (data.termId ?? null) && item.subjectId === (data.subjectId ?? null) &&
      item.gradeLevelId === gradeLevelId);
    if (existing) return existing;
    const legacy = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      academicYearId: year?.id ?? null, termId: data.termId ?? null,
      gradeLevelId, subjectId: data.subjectId ?? null, examTypeId: legacyType.id,
      title: 'Legacy results', weightBasisPoints: 10000, maxValue: data.maxValue,
      status: 'draft', isLegacy: true, createdBy: actor.sub, createdAt: now()
    };
    this.exams.push(legacy);
    return legacy;
  }
};
