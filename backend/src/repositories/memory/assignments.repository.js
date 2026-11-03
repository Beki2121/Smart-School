import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { auditRow, campusScopeError, now, planLimitError, setupConflict } from '../shared.js';
import {
  assignmentConflict, mapAssignment, mapAssignmentAttachment, mapAssignmentSubmission,
  validateAssignmentFile
} from '../assignments.mappers.js';

function campusFor(repo, actor, campusId = actor.activeCampusId) {
  return repo.campuses.find((campus) =>
    campus.id === campusId && campus.organizationId === actor.orgId);
}

function studentSection(repo, studentId, academicYearId, sectionId = null) {
  return repo.enrolments.find((enrolment) => enrolment.studentId === studentId &&
    enrolment.academicYearId === academicYearId && enrolment.status === 'active' &&
    (!sectionId || enrolment.sectionId === sectionId));
}

function assignmentTeachingScope(repo, actor, sectionId, subjectId) {
  const staffIds = new Set(repo.staff.filter((staff) =>
    staff.userId === actor.sub && staff.campusId === actor.activeCampusId && !staff.archivedAt)
    .map((staff) => staff.id));
  return repo.teachingAssignments.some((item) => item.isActive &&
    item.campusId === actor.activeCampusId && staffIds.has(item.staffId) &&
    item.sectionId === sectionId && item.subjectId === subjectId);
}

function mayManageAcrossClasses(actor) {
  return ['owner_director', 'academic_head', 'principal', 'system_admin'].includes(actor.role);
}

function validateGrade(grade) {
  if (!Number.isFinite(grade) || grade < 0 || grade > 1000 || !Number.isInteger(grade * 100)) {
    throw assignmentConflict('Assignment grades must be from 0 to 1000 with at most two decimal places.');
  }
}

function filesFor(repo, assignmentId, type, submissionId = null) {
  return repo.assignmentAttachments.filter((item) => item.assignmentId === assignmentId &&
    item.type === type && (!submissionId || item.submissionId === submissionId))
    .map(mapAssignmentAttachment);
}

function itemFor(repo, assignment) {
  return mapAssignment(assignment, filesFor(repo, assignment.id, 'assignment'));
}

function submissionFor(repo, submission) {
  return mapAssignmentSubmission(submission, filesFor(
    repo, submission.assignmentId, 'submission', submission.id
  ));
}

function notificationsFor(repo, assignment, type) {
  const students = repo.students.filter((student) => student.campusId === assignment.campusId &&
    student.status === 'enrolled' && !student.archivedAt &&
    studentSection(repo, student.id, assignment.academicYearId, assignment.sectionId));
  const recipients = new Set();
  for (const student of students) {
    if (student.userId) recipients.add(student.userId);
    for (const link of repo.studentGuardians) {
      if (link.studentId !== student.id || !link.isVerified) continue;
      const guardian = repo.guardians.find((item) =>
        item.id === link.guardianId && item.orgId === assignment.organizationId);
      if (guardian?.userId) recipients.add(guardian.userId);
    }
  }
  const sourceType = type === 'submission' ? 'assignment_submission' : type;
  for (const userId of recipients) {
    if (repo.userNotifications.some((notice) => notice.userId === userId &&
        notice.sourceType === sourceType && notice.sourceId === assignment.id)) continue;
    repo.userNotifications.push({
      id: randomUUID(), campusId: assignment.campusId, userId, sourceType,
      sourceId: assignment.id,
      titleEn: type === 'assignment_due_soon' ? 'Assignment due soon' : 'New assignment',
      titleAm: type === 'assignment_due_soon' ? 'የቤት ሥራ ቀነ ገደብ ቀርቧል' : 'አዲስ የቤት ሥራ',
      bodyEn: assignment.title, bodyAm: assignment.title, readAt: null, createdAt: now()
    });
  }
}

function assertAssignmentContext(repo, data, actor) {
  const campus = campusFor(repo, actor);
  const section = repo.sections.find((item) => item.id === data.sectionId &&
    item.campusId === actor.activeCampusId);
  const year = repo.academicYears.find((item) => item.id === data.academicYearId &&
    item.campusId === actor.activeCampusId);
  const term = year?.terms?.find((item) => item.id === data.termId);
  if (!campus || !section || !year || !term || section.gradeLevelId !== data.gradeLevelId ||
      section.academicYearId !== data.academicYearId || !repo.subjects.some((item) =>
        item.id === data.subjectId && item.campusId === actor.activeCampusId)) {
    throw campusScopeError('Assignment class, subject, and academic period must belong to the active campus.');
  }
  if (!mayManageAcrossClasses(actor) &&
      !assignmentTeachingScope(repo, actor, data.sectionId, data.subjectId)) {
    throw campusScopeError('Teachers may manage assignments only for their assigned class and subject.');
  }
}

function assertFileQuota(repo, sizeBytes, actor) {
  const subscription = repo.subscriptions.find((item) => item.organizationId === actor.orgId);
  const plan = subscription && repo.subscriptionPlans.find((item) => item.id === subscription.planId);
  if (plan?.storageLimitBytes == null) return;
  if (repo.getOrganizationStorageUsage(actor.orgId) + sizeBytes > plan.storageLimitBytes) {
    throw planLimitError('storage', plan.storageLimitBytes,
      repo.getOrganizationStorageUsage(actor.orgId));
  }
}

function addAssignmentAttachment(repo, assignment, validFile, actor, type, submission = null) {
  const id = randomUUID();
  const storageKey = path.join(actor.orgId, actor.activeCampusId, 'assignments', assignment.id, id);
  const row = {
    id, organizationId: actor.orgId, campusId: actor.activeCampusId, assignmentId: assignment.id,
    submissionId: submission?.id ?? null, type, originalName: validFile.originalName,
    mimeType: validFile.mimeType, sizeBytes: validFile.content.length, storageKey,
    sha256: createHash('sha256').update(validFile.content).digest('hex'),
    uploadedBy: actor.sub, content: Buffer.from(validFile.content), createdAt: now()
  };
  repo.assignmentAttachments.push(row);
  return mapAssignmentAttachment(row);
}

export const memoryAssignmentsBundle = {
  async listAssignments(actor) {
    if (!campusFor(this, actor)) return [];
    const isViewer = mayManageAcrossClasses(actor);
    return this.assignments.filter((item) => item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.status !== 'archived' &&
      (isViewer || assignmentTeachingScope(this, actor, item.sectionId, item.subjectId)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((item) => itemFor(this, item));
  },

  async createAssignment(data, actor) {
    assertAssignmentContext(this, data, actor);
    const assignment = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'draft', createdBy: actor.sub, publishedAt: null,
      createdAt: now(), updatedAt: now()
    };
    this.assignments.push(assignment);
    await this.appendAudit(actor, 'assignment.created', 'assignment', assignment.id, null, itemFor(this, assignment));
    return itemFor(this, assignment);
  },

  async updateAssignment(id, data, actor) {
    const assignment = this.assignments.find((item) => item.id === id &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!assignment) return null;
    if (!mayManageAcrossClasses(actor) &&
        !assignmentTeachingScope(this, actor, assignment.sectionId, assignment.subjectId)) {
      throw campusScopeError('Teachers may manage assignments only for their assigned class and subject.');
    }
    if (assignment.status !== 'draft') throw assignmentConflict('Only draft assignments can be edited.');
    const next = { ...assignment, ...data };
    assertAssignmentContext(this, next, actor);
    const before = itemFor(this, assignment);
    Object.assign(assignment, data, { updatedAt: now() });
    await this.appendAudit(actor, 'assignment.updated', 'assignment', id, before, itemFor(this, assignment));
    return itemFor(this, assignment);
  },

  async transitionAssignment(id, status, actor) {
    const assignment = this.assignments.find((item) => item.id === id &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!assignment) return null;
    if (!mayManageAcrossClasses(actor) &&
        !assignmentTeachingScope(this, actor, assignment.sectionId, assignment.subjectId)) {
      throw campusScopeError('Teachers may manage assignments only for their assigned class and subject.');
    }
    const valid = (assignment.status === 'draft' && status === 'published') ||
      (assignment.status === 'published' && status === 'closed') ||
      (assignment.status === 'closed' && status === 'archived');
    if (!valid) throw assignmentConflict(`Cannot transition an assignment from ${assignment.status} to ${status}.`);
    const before = itemFor(this, assignment);
    assignment.status = status;
    assignment.updatedAt = now();
    if (status === 'published') assignment.publishedAt = now();
    if (status === 'closed') assignment.closedAt = now();
    if (status === 'archived') assignment.archivedAt = now();
    await this.appendAudit(actor, `assignment.${status}`, 'assignment', id, before, itemFor(this, assignment));
    if (status === 'published') notificationsFor(this, assignment, 'assignment_published');
    return itemFor(this, assignment);
  },

  async listAssignmentSubmissions(assignmentId, actor) {
    const assignment = this.assignments.find((item) => item.id === assignmentId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!assignment) return null;
    if (!mayManageAcrossClasses(actor) &&
        !assignmentTeachingScope(this, actor, assignment.sectionId, assignment.subjectId)) {
      throw campusScopeError('Submissions are available only to the assigned teacher.');
    }
    return this.assignmentSubmissions.filter((item) => item.assignmentId === assignmentId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)
      .map((submission) => {
        const student = this.students.find((item) => item.id === submission.studentId);
        const named = { ...submission,
          studentName: student ? `${student.givenNameEn} ${student.fatherNameEn}` : '' };
        return submissionFor(this, named);
      });
  },

  async storeAssignmentAttachment(assignmentId, file, actor) {
    const assignment = this.assignments.find((item) => item.id === assignmentId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!assignment) return null;
    if (assignment.status !== 'draft') throw assignmentConflict('Attachments can be added only to draft assignments.');
    if (!mayManageAcrossClasses(actor) &&
        !assignmentTeachingScope(this, actor, assignment.sectionId, assignment.subjectId)) {
      throw campusScopeError('Teachers may manage assignments only for their assigned class and subject.');
    }
    const validFile = validateAssignmentFile(file);
    assertFileQuota(this, validFile.content.length, actor);
    const attachment = addAssignmentAttachment(this, assignment, validFile, actor, 'assignment');
    await this.appendAudit(actor, 'assignment.attachment_uploaded', 'assignment_attachment',
      attachment.id, null, attachment);
    return attachment;
  },

  async listPortalAssignments(actor) {
    const campusIds = new Set(actor.campusIds ?? []);
    let students;
    if (actor.role === 'student') {
      students = this.students.filter((student) => student.userId === actor.sub &&
        campusIds.has(student.campusId) && student.status === 'enrolled' && !student.archivedAt);
    } else {
      const guardianIds = new Set(this.guardians.filter((guardian) =>
        guardian.userId === actor.sub && guardian.orgId === actor.orgId).map((guardian) => guardian.id));
      const studentIds = new Set(this.studentGuardians.filter((link) =>
        guardianIds.has(link.guardianId) && link.isVerified).map((link) => link.studentId));
      students = this.students.filter((student) => studentIds.has(student.id) &&
        campusIds.has(student.campusId) && student.status === 'enrolled' && !student.archivedAt);
    }
    const rows = [];
    for (const student of students) {
      for (const assignment of this.assignments) {
        if (assignment.organizationId !== actor.orgId || assignment.campusId !== student.campusId ||
            !['published', 'closed'].includes(assignment.status) ||
            !studentSection(this, student.id, assignment.academicYearId, assignment.sectionId)) continue;
        const submission = this.assignmentSubmissions.find((item) =>
          item.assignmentId === assignment.id && item.studentId === student.id);
        rows.push({
          ...itemFor(this, assignment), studentId: student.id,
          studentName: `${student.givenNameEn} ${student.fatherNameEn}`,
          submission: submission ? submissionFor(this, submission) : null
        });
      }
    }
    return rows;
  },

  async submitAssignment(assignmentId, data, actor) {
    const student = this.students.find((item) => item.userId === actor.sub &&
      item.campusId === actor.activeCampusId && item.status === 'enrolled' && !item.archivedAt);
    if (!student) return null;
    const assignment = this.assignments.find((item) => item.id === assignmentId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!assignment) return null;
    if (assignment.status !== 'published') {
      throw assignmentConflict('Closed or unpublished assignments cannot be submitted.');
    }
    if (!studentSection(this, student.id, assignment.academicYearId, assignment.sectionId)) {
      return null;
    }
    const before = this.assignmentSubmissions.find((item) =>
      item.assignmentId === assignment.id && item.studentId === student.id);
    const submission = before ?? {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      assignmentId, studentId: student.id, createdAt: now()
    };
    const previous = before ? submissionFor(this, before) : null;
    Object.assign(submission, {
      text: data.text ?? null, submittedAt: now(),
      isLate: new Date() > new Date(assignment.dueAt),
      status: 'submitted', grade: null, feedback: null, gradedBy: null, gradedAt: null,
      updatedAt: now()
    });
    if (!before) this.assignmentSubmissions.push(submission);
    const updated = submissionFor(this, submission);
    await this.appendAudit(actor, before ? 'assignment.submission_resubmitted' : 'assignment.submitted',
      'assignment_submission', submission.id, previous, updated);
    if (!before) {
      const teacher = this.users.find((user) => user.id === assignment.createdBy);
      if (teacher && !this.userNotifications.some((notice) => notice.userId === teacher.id &&
          notice.sourceType === 'assignment_submission' && notice.sourceId === submission.id)) {
        this.userNotifications.push({
          id: randomUUID(), campusId: assignment.campusId, userId: teacher.id,
          sourceType: 'assignment_submission', sourceId: submission.id,
          titleEn: 'New assignment submission', titleAm: 'አዲስ የቤት ሥራ ማስገባት',
          bodyEn: assignment.title, bodyAm: assignment.title, readAt: null, createdAt: now()
        });
      }
    }
    return updated;
  },

  async storeSubmissionAttachment(assignmentId, file, actor) {
    const student = this.students.find((item) => item.userId === actor.sub &&
      item.campusId === actor.activeCampusId && item.status === 'enrolled' && !item.archivedAt);
    const assignment = this.assignments.find((item) => item.id === assignmentId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!student || !assignment || !studentSection(
      this, student.id, assignment.academicYearId, assignment.sectionId
    )) return null;
    if (assignment.status !== 'published') throw assignmentConflict('Closed or unpublished assignments cannot be submitted.');
    const validFile = validateAssignmentFile(file);
    assertFileQuota(this, validFile.content.length, actor);
    let submission = this.assignmentSubmissions.find((item) =>
      item.assignmentId === assignment.id && item.studentId === student.id);
    if (!submission) {
      submission = {
        id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        assignmentId, studentId: student.id, text: null, submittedAt: now(),
        isLate: new Date() > new Date(assignment.dueAt), status: 'submitted',
        grade: null, feedback: null, gradedBy: null, gradedAt: null, createdAt: now(), updatedAt: now()
      };
      this.assignmentSubmissions.push(submission);
      await this.appendAudit(actor, 'assignment.submitted', 'assignment_submission',
        submission.id, null, submissionFor(this, submission));
      const teacher = this.users.find((user) => user.id === assignment.createdBy);
      if (teacher && !this.userNotifications.some((notice) => notice.userId === teacher.id &&
          notice.sourceType === 'assignment_submission' && notice.sourceId === submission.id)) {
        this.userNotifications.push({
          id: randomUUID(), campusId: assignment.campusId, userId: teacher.id,
          sourceType: 'assignment_submission', sourceId: submission.id,
          titleEn: 'New assignment submission', titleAm: 'አዲስ የቤት ሥራ ማስገባት',
          bodyEn: assignment.title, bodyAm: assignment.title, readAt: null, createdAt: now()
        });
      }
    } else {
      const before = submissionFor(this, submission);
      Object.assign(submission, {
        submittedAt: now(), isLate: new Date() > new Date(assignment.dueAt),
        status: 'submitted', grade: null, feedback: null, gradedBy: null, gradedAt: null,
        updatedAt: now()
      });
      await this.appendAudit(actor, 'assignment.submission_resubmitted',
        'assignment_submission', submission.id, before, submissionFor(this, submission));
    }
    const attachment = addAssignmentAttachment(this, assignment, validFile, actor, 'submission', submission);
    await this.appendAudit(actor, 'assignment.submission_attachment_uploaded',
      'assignment_attachment', attachment.id, null, attachment);
    return attachment;
  },

  async gradeAssignmentSubmission(assignmentId, submissionId, data, actor) {
    const assignment = this.assignments.find((item) => item.id === assignmentId &&
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!assignment) return null;
    if (!assignmentTeachingScope(this, actor, assignment.sectionId, assignment.subjectId)) {
      throw campusScopeError('Only the assigned teacher may grade this assignment.');
    }
    const submission = this.assignmentSubmissions.find((item) => item.id === submissionId &&
      item.assignmentId === assignmentId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!submission) return null;
    validateGrade(data.grade);
    if (submission.status !== 'submitted' && submission.status !== 'graded') {
      throw assignmentConflict('This submission cannot be graded in its current state.');
    }
    const before = submissionFor(this, submission);
    Object.assign(submission, {
      grade: data.grade, feedback: data.feedback ?? null, gradedBy: actor.sub,
      gradedAt: now(), status: 'graded', updatedAt: now()
    });
    await this.appendAudit(actor, 'assignment.submission_graded', 'assignment_submission',
      submission.id, before, submissionFor(this, submission));
    return submissionFor(this, submission);
  },

  async getAssignmentAttachment(id, actor) {
    const item = this.assignmentAttachments.find((attachment) => attachment.id === id &&
      attachment.organizationId === actor.orgId && attachment.campusId === actor.activeCampusId);
    if (!item) return null;
    const assignment = this.assignments.find((assignment) =>
      assignment.id === item.assignmentId && assignment.organizationId === actor.orgId &&
      assignment.campusId === actor.activeCampusId);
    if (!assignment || (!mayManageAcrossClasses(actor) &&
        !assignmentTeachingScope(this, actor, assignment.sectionId, assignment.subjectId))) return null;
    return { ...mapAssignmentAttachment(item), content: Buffer.from(item.content) };
  },

  async getPortalAssignmentAttachment(id, actor) {
    const item = this.assignmentAttachments.find((attachment) => attachment.id === id &&
      attachment.organizationId === actor.orgId);
    if (!item) return null;
    const visible = await this.listPortalAssignments(actor);
    if (!visible.some((assignment) => assignment.id === item.assignmentId &&
        assignment.campusId === item.campusId &&
        (item.type === 'assignment' || assignment.submission?.id === item.submissionId))) return null;
    return { ...mapAssignmentAttachment(item), content: Buffer.from(item.content) };
  },

  async processAssignmentDueNotifications(at = new Date()) {
    const nowAt = new Date(at);
    for (const assignment of this.assignments) {
      if (assignment.status !== 'published') continue;
      const dueAt = new Date(assignment.dueAt);
      if (dueAt > nowAt && dueAt <= new Date(nowAt.valueOf() + 24 * 60 * 60 * 1000)) {
        notificationsFor(this, assignment, 'assignment_due_soon');
      }
    }
  }
};
