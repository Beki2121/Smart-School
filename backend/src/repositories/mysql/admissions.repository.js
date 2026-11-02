import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addisDate, auditRow, campusScopeError, now, setupConflict } from '../shared.js';
import { generateStudentCredentials, mapStudent, studentName } from '../students.mappers.js';
import { formatStudentNo, mapAdmission, mapAdmissionDocument, toMysqlDateTime } from '../admissions.mappers.js';
import { invalidDocument, isValidDocumentContent, safeFilename } from '../documents.mappers.js';

export const mysqlAdmissionsBundle = {
  async getAdmissionsDashboard(campusId) {
    const statusRows = await this.db('admissions').where({ campus_id: campusId })
      .groupBy('status').select('status').count({ total: '*' });
    const byStatus = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.total)]));
    const gradeRows = await this.db('admissions as a')
      .join('grade_levels as g', 'g.id', 'a.grade_level_id')
      .where({ 'a.campus_id': campusId })
      .groupBy('g.id', 'g.name_en').select('g.name_en as grade')
      .count({ total: '*' })
      .count({ enrolled: this.db.raw('CASE WHEN a.status = ? THEN 1 END', ['enrolled']) });
    return {
      total: statusRows.reduce((sum, row) => sum + Number(row.total), 0),
      byStatus, byGrade: gradeRows.map((row) => ({ grade: row.grade, total: Number(row.total), enrolled: Number(row.enrolled) }))
    };
  },
  async getPublicAdmissionInfo(token) {
    const campus = await this.db('campuses').where({
      admissions_public_token: token, is_active: true
    }).first();
    if (!campus) return null;
    const year = await this.db('academic_years').where({
      campus_id: campus.id, status: 'active'
    }).first('id');
    if (!year) return null;
    const grades = await this.db('grade_levels').where({ campus_id: campus.id })
      .orderBy('sort_order').select('id', 'name_en', 'name_am');
    const organization = await this.db('organizations').where({ id: campus.organization_id }).first('name');
    return {
      schoolName: organization?.name ?? campus.name, campusName: campus.name,
      address: campus.address ?? '', phone: campus.phone ?? '',
      grades: grades.map((grade) => ({ id: grade.id, nameEn: grade.name_en, nameAm: grade.name_am }))
    };
  },
  async getAdmissionsPublicToken(campusId) {
    const campus = await this.db('campuses').where({ id: campusId, is_active: true })
      .first('admissions_public_token');
    return campus?.admissions_public_token ?? null;
  },
  async createPublicAdmission(token, data) {
    const campus = await this.db('campuses').where({
      admissions_public_token: token, is_active: true
    }).first('id', 'organization_id');
    if (!campus || !await this.getPublicAdmissionInfo(token)) return null;
    return this.createAdmission(data, {
      sub: 'public-intake', orgId: campus.organization_id, activeCampusId: campus.id
    });
  },
  async listAdmissions(campusId, { status = null, query = '' } = {}) {
    const builder = this.db('admissions as a').join('grade_levels as g', 'g.id', 'a.grade_level_id')
      .leftJoin('students as s', 's.id', 'a.student_id')
      .where({ 'a.campus_id': campusId })
      .select('a.*', 'g.name_en as grade_name', 's.student_no');
    if (status) builder.where('a.status', status);
    if (query) builder.where((where) => where
      .where('a.given_name_en', 'like', `%${query}%`)
      .orWhere('a.father_name_en', 'like', `%${query}%`)
      .orWhere('a.grandfather_name_en', 'like', `%${query}%`)
      .orWhere('a.given_name_am', 'like', `%${query}%`)
      .orWhere('a.father_name_am', 'like', `%${query}%`)
      .orWhere('a.grandfather_name_am', 'like', `%${query}%`)
      .orWhere('a.guardian_name', 'like', `%${query}%`)
      .orWhere('a.guardian_phone', 'like', `%${query}%`));
    const rows = await builder.orderBy('a.created_at', 'desc').limit(500);
    return Promise.all(rows.map((row) => this.enrichAdmission(row)));
  },
  async getAdmission(campusId, admissionId) {
    const row = await this.db('admissions as a')
      .join('grade_levels as g', 'g.id', 'a.grade_level_id')
      .leftJoin('students as s', 's.id', 'a.student_id')
      .where({ 'a.id': admissionId, 'a.campus_id': campusId })
      .select('a.*', 'g.name_en as grade_name', 's.student_no').first();
    return row ? this.enrichAdmission(row) : null;
  },
  async enrichAdmission(row) {
    const admission = mapAdmission(row);
    const documents = await this.listAdmissionDocuments(row.campus_id, row.id);
    return {
      ...admission, documents,
      documentChecklist: admission.requiredDocuments.map((type) => ({
        type, complete: documents.some((document) => document.documentType === type)
      }))
    };
  },
  async findAdmissionDuplicates(campusId, { name = '', dateOfBirth = '', guardianPhone = '' }) {
    const needle = name.trim();
    const duplicateWhere = (builder) => {
      let hasWhere = false;
      if (guardianPhone) {
        builder.where('guardian_phone', guardianPhone);
        hasWhere = true;
      }
      if (needle && dateOfBirth) {
        const nameMatch = (condition) => condition
          .whereRaw('LOWER(CONCAT(given_name_en, " ", father_name_en, " ", grandfather_name_en)) = LOWER(?)', [needle])
          .orWhereRaw('LOWER(CONCAT(given_name_am, " ", father_name_am, " ", grandfather_name_am)) = LOWER(?)', [needle]);
        builder[hasWhere ? 'orWhere' : 'where']((condition) =>
          condition.where('date_of_birth', dateOfBirth).andWhere(nameMatch));
      }
    };
    const [admissions, students] = await Promise.all([
      this.db('admissions').where({ campus_id: campusId }).andWhere(duplicateWhere)
        .select('id', 'status', 'given_name_en', 'father_name_en', 'grandfather_name_en', 'guardian_phone'),
      this.db('students').where({ campus_id: campusId }).andWhere(duplicateWhere)
        .select('id', 'status', 'given_name_en', 'father_name_en', 'grandfather_name_en', 'guardian_phone')
    ]);
    return [
      ...admissions.map((row) => ({ id: row.id, type: 'admission', status: row.status, name: `${row.given_name_en} ${row.father_name_en} ${row.grandfather_name_en}`, guardianPhone: row.guardian_phone })),
      ...students.map((row) => ({ id: row.id, type: 'student', status: row.status, name: `${row.given_name_en} ${row.father_name_en} ${row.grandfather_name_en}`, guardianPhone: row.guardian_phone ?? '' }))
    ];
  },
  async createAdmission(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    const grade = await this.db('grade_levels').where({
      id: data.gradeLevelId, campus_id: actor.activeCampusId
    }).first();
    if (!year || !grade) throw campusScopeError('An active academic year and campus grade are required.');
    const id = randomUUID();
    const admission = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      academic_year_id: year.id, given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
      grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
      father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
      gender: data.gender, date_of_birth: data.dateOfBirth ?? null,
      guardian_name: data.guardianName, guardian_phone: data.guardianPhone,
      guardian_email: data.guardianEmail ?? null, grade_level_id: data.gradeLevelId,
      previous_school: data.previousSchool ?? null,
      status: actor.sub === 'public-intake' ? 'application' : 'enquiry',
      public_submission: actor.sub === 'public-intake',
      privacy_consent_at: actor.sub === 'public-intake' ? new Date() : null,
      required_documents: JSON.stringify(['birth_certificate', 'previous_school_report', 'guardian_id']),
      created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('admissions').insert(admission);
      await trx('audit_log').insert(auditRow(actor, 'admission.created', 'admission', id, null, data));
    });
    return this.getAdmission(actor.activeCampusId, id);
  },
  async scheduleAdmissionInterview(admissionId, data, actor) {
    const found = await this.db.transaction(async (trx) => {
      const row = await trx('admissions').where({
        id: admissionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      if (!['application', 'interview'].includes(row.status)) throw setupConflict('Only applicants may be scheduled for an interview.');
      const before = { status: row.status, interviewAt: row.interview_at, interviewResult: row.interview_result };
      await trx('admissions').where({ id: admissionId }).update({
        status: 'interview', interview_at: toMysqlDateTime(data.interviewAt), interview_result: data.interviewResult
      });
      await trx('audit_log').insert(auditRow(actor, 'admission.interview_scheduled', 'admission', admissionId, before, data));
      return true;
    });
    return found ? this.getAdmission(actor.activeCampusId, admissionId) : null;
  },
  async updateAdmissionStatus(admissionId, data, actor) {
    const found = await this.db.transaction(async (trx) => {
      const row = await trx('admissions').where({
        id: admissionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      const allowed = {
        enquiry: ['application', 'rejected'], application: ['accepted', 'waitlisted', 'rejected', 'interview'],
        interview: ['accepted', 'waitlisted', 'rejected'], waitlisted: ['accepted', 'rejected']
      };
      if (!allowed[row.status]?.includes(data.status)) throw setupConflict(`Cannot move an admission from ${row.status} to ${data.status}.`);
      await trx('admissions').where({ id: admissionId }).update({
        status: data.status, decision_note: data.decisionNote
      });
      await trx('audit_log').insert(auditRow(actor, `admission.${data.status}`, 'admission', admissionId, { status: row.status }, data));
      return true;
    });
    return found ? this.getAdmission(actor.activeCampusId, admissionId) : null;
  },
  async storeAdmissionDocument(admissionId, documentType, originalName, mimeType, content, actor) {
    const admission = await this.db('admissions').where({
      id: admissionId, campus_id: actor.activeCampusId
    }).first();
    if (!admission) throw campusScopeError('Admission is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content)) throw invalidDocument('The document content does not match its declared file type.');
    const id = randomUUID();
    const storageKey = randomUUID();
    const document = {
      id, admission_id: admissionId, document_type: documentType,
      original_name: safeFilename(originalName),
      mime_type: mimeType, size_bytes: content.length, storage_key: storageKey,
      sha256: createHash('sha256').update(content).digest('hex'), uploaded_by: actor.sub
    };
    const filePath = path.join(this.privateDocumentsDir, storageKey);
    await mkdir(this.privateDocumentsDir, { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    try {
      await this.db.transaction(async (trx) => {
        await this.assertStorageCapacity(actor.orgId, content.length, 0, trx);
        await trx('admission_documents').insert(document);
        await trx('audit_log').insert(auditRow(actor, 'admission.document_uploaded', 'admission_document', id, null, {
          admissionId, documentType, sizeBytes: content.length, sha256: document.sha256
        }));
      });
    } catch (error) {
      try {
        await unlink(filePath);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Document metadata write and private-file cleanup both failed.');
      }
      throw error;
    }
    return mapAdmissionDocument(document);
  },
  async listAdmissionDocuments(campusId, admissionId) {
    const admission = await this.db('admissions').where({ id: admissionId, campus_id: campusId }).first();
    if (!admission) return [];
    const rows = await this.db('admission_documents').where({ admission_id: admissionId }).orderBy('created_at', 'desc');
    return rows.map(mapAdmissionDocument);
  },
  async getAdmissionDocument(campusId, admissionId, documentId) {
    const rows = await this.db('admission_documents as d')
      .join('admissions as a', 'a.id', 'd.admission_id')
      .where({ 'a.campus_id': campusId, 'a.id': admissionId, 'd.id': documentId })
      .select('d.*').first();
    if (!rows) return null;
    const filePath = path.join(this.privateDocumentsDir, path.basename(rows.storage_key));
    return { document: mapAdmissionDocument(rows), content: await readFile(filePath) };
  },
  async enrolAdmission(admissionId, { sectionId, siblingStudentId = null }, actor) {
    const result = await this.db.transaction(async (trx) => {
      const admission = await trx('admissions').where({
        id: admissionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!admission) throw campusScopeError('Admission is outside the active campus.');
      if (admission.status !== 'accepted') throw setupConflict('Only accepted applicants can be enrolled.');
      const required = Array.isArray(admission.required_documents)
        ? admission.required_documents : JSON.parse(admission.required_documents);
      const uploaded = await trx('admission_documents').where({ admission_id: admissionId }).pluck('document_type');
      if (required.some((type) => !uploaded.includes(type))) throw setupConflict('All required documents must be uploaded before enrolment.');
      const section = await trx('sections as s').join('academic_years as y', 'y.id', 's.academic_year_id')
        .where({
          's.id': sectionId, 's.campus_id': actor.activeCampusId,
          's.grade_level_id': admission.grade_level_id,
          's.academic_year_id': admission.academic_year_id, 'y.status': 'active'
        }).forUpdate().select('s.*').first();
      if (!section) throw campusScopeError('Select an active section for the applicant’s grade and academic year at this campus.');
      if (section.capacity != null) {
        const count = await trx('enrolments').where({
          section_id: sectionId, academic_year_id: admission.academic_year_id, status: 'active'
        }).count({ total: '*' }).first();
        if (Number(count.total) >= Number(section.capacity)) throw setupConflict('The selected section has reached capacity.');
      }
      if (siblingStudentId) {
        const sibling = await trx('students').where({
          id: siblingStudentId, campus_id: actor.activeCampusId, status: 'enrolled'
        }).first();
        if (!sibling) throw campusScopeError('Sibling student is not enrolled at this campus.');
      }
      const campus = await trx('campuses').where({ id: actor.activeCampusId }).first();
      await trx('admission_counters').insert({
        campus_id: actor.activeCampusId, academic_year_id: admission.academic_year_id, last_value: 0
      }).onConflict(['campus_id', 'academic_year_id']).ignore();
      const counter = await trx('admission_counters').where({
        campus_id: actor.activeCampusId, academic_year_id: admission.academic_year_id
      }).forUpdate().first();
      const sequence = Number(counter.last_value) + 1;
      const year = await trx('academic_years').where({ id: admission.academic_year_id }).first();
      const studentNo = formatStudentNo(campus.student_id_pattern, campus.name, year.label_ec, sequence);
      await trx('admission_counters').where({
        campus_id: actor.activeCampusId, academic_year_id: admission.academic_year_id
      }).update({ last_value: sequence });
      const studentId = randomUUID();
      const studentData = {
        givenNameEn: admission.given_name_en, fatherNameEn: admission.father_name_en,
        grandfatherNameEn: admission.grandfather_name_en,
        studentNo, givenNameAm: admission.given_name_am, fatherNameAm: admission.father_name_am,
        grandfatherNameAm: admission.grandfather_name_am
      };
      const generated = await generateStudentCredentials(studentData, async (username) =>
        Boolean(await trx('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first('id')));
      const userId = randomUUID();
      await trx('users').insert({
        id: userId, organization_id: actor.orgId, name: studentName(studentData),
        username: generated.username, password_hash: generated.passwordHash,
        role: 'student', must_change_password: true, is_active: true
      });
      await trx('user_campuses').insert({
        user_id: userId, campus_id: actor.activeCampusId, is_active: true
      });
      await trx('students').insert({
        id: studentId, campus_id: actor.activeCampusId, student_no: studentNo,
        user_id: userId, status: 'enrolled',
        given_name_am: admission.given_name_am, father_name_am: admission.father_name_am,
        grandfather_name_am: admission.grandfather_name_am, given_name_en: admission.given_name_en,
        father_name_en: admission.father_name_en, grandfather_name_en: admission.grandfather_name_en,
        gender: admission.gender, date_of_birth: admission.date_of_birth,
        section_name: section.name, previous_school: admission.previous_school,
        guardian_phone: admission.guardian_phone, status: 'enrolled'
      });
      await trx('enrolments').insert({
        id: randomUUID(), student_id: studentId, academic_year_id: admission.academic_year_id,
        section_id: sectionId, status: 'active', enrolled_on: addisDate()
      });
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status: 'enrolled', reason: `Admission ${admissionId}`, recorded_by: actor.sub
      });
      await trx('admissions').where({ id: admissionId }).update({
        status: 'enrolled', section_id: sectionId, student_id: studentId,
        sibling_student_id: siblingStudentId
      });
      if (siblingStudentId) {
        await trx('student_siblings').insert([
          { student_id: studentId, sibling_student_id: siblingStudentId, campus_id: actor.activeCampusId },
          { student_id: siblingStudentId, sibling_student_id: studentId, campus_id: actor.activeCampusId }
        ]).onConflict().ignore();
      }
      await trx('audit_log').insert(auditRow(actor, 'admission.enrolled', 'student', studentId, {
        admissionId, status: 'accepted'
      }, { studentNo, sectionId, siblingStudentId }));
      await trx('audit_log').insert(auditRow(actor, 'student.account_created', 'user', userId, null, {
        studentId, username: generated.username
      }));
      return {
        studentId, studentNo,
        credentials: {
          username: generated.username, temporaryPassword: generated.temporaryPassword,
          studentName: generated.studentName
        }
      };
    });
    const studentRow = await this.db('students').where({ id: result.studentId }).first();
    return {
      student: mapStudent(studentRow), admission: await this.getAdmission(actor.activeCampusId, admissionId),
      credentials: result.credentials
    };
  }
};
