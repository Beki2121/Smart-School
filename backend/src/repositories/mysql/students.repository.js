import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decryptSensitiveValue, encryptSensitiveValue, hashSensitiveIdentifier } from '../../secure-fields.js';
import { addisDate, auditRow, campusScopeError, now, planLimitError, setupConflict } from '../shared.js';
import { invalidDocument, isValidDocumentContent, safeFilename } from '../documents.mappers.js';
import {
  generateStudentCredentials, mapStudent, mapStudentCommendation, mapStudentDisciplineRecord,
  mapStudentDocument, mapStudentGuardian, mapStudentTransferPackage, normalizeImportValue,
  studentForActor, studentImportReports, studentName
} from '../students.mappers.js';

export const mysqlStudentsBundle = {
  async assertStudentCapacity(organizationId, additional = 1, query = this.db) {
    const subscription = await query('organization_subscriptions as os')
      .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
      .where('os.organization_id', organizationId).orderBy('os.created_at', 'desc')
      .forUpdate().select('sp.student_limit').first();
    if (!subscription || subscription.student_limit == null) return;
    const result = await query('students as s')
      .join('campuses as c', 'c.id', 's.campus_id')
      .where('c.organization_id', organizationId).whereNull('s.archived_at')
      .count({ total: 's.id' }).first();
    if (Number(result.total) + additional > Number(subscription.student_limit)) {
      throw planLimitError('student', Number(subscription.student_limit));
    }
  },
  async listStudents(campusId) {
    const rows = await this.db('students').where({ campus_id: campusId }).whereNull('archived_at')
      .orderBy('created_at', 'desc').limit(250);
    const placements = rows.length ? await this.db('enrolments as e')
      .join('sections as s', 's.id', 'e.section_id')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .whereIn('e.student_id', rows.map((row) => row.id))
      .where({ 'e.status': 'active', 'y.status': 'active', 's.campus_id': campusId })
      .select('e.student_id', 's.id as section_id', 's.grade_level_id', 's.stream') : [];
    const placementByStudent = new Map(placements.map((row) => [row.student_id, row]));
    return rows.map((row) => mapStudent({ ...row, ...(placementByStudent.get(row.id) ?? {}) }));
  },
  async createStudent(data, actor) {
    const id = randomUUID();
    const placement = await this.db('sections as s')
      .join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({
        's.campus_id': actor.activeCampusId, 's.name': data.sectionName,
        'y.status': 'active'
      })
      .select('s.id as section_id', 's.academic_year_id')
      .first();
    if (!placement) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    try {
      const credentials = await this.db.transaction(async (trx) => {
        await this.assertUserCapacity(actor.orgId, 1, null, trx);
        await this.assertStudentCapacity(actor.orgId, 1, trx);
        const generated = await generateStudentCredentials(data, async (username) =>
          Boolean(await trx('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first('id')));
        const userId = randomUUID();
        await trx('users').insert({
          id: userId, organization_id: actor.orgId, name: studentName(data),
          username: generated.username, password_hash: generated.passwordHash,
          role: 'student', must_change_password: true, is_active: true
        });
        await trx('user_campuses').insert({
          user_id: userId, campus_id: actor.activeCampusId, is_active: true
        });
        await trx('students').insert({
          id, campus_id: actor.activeCampusId, student_no: data.studentNo,
          user_id: userId, status: 'enrolled',
          given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
          grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
          father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
          gender: data.gender, date_of_birth: data.dateOfBirth ?? null,
          guardian_phone: data.guardianPhone ?? null, previous_school: data.previousSchool ?? null,
          section_name: data.sectionName ?? null
        });
        await trx('enrolments').insert({
          id: randomUUID(), student_id: id, academic_year_id: placement.academic_year_id,
          section_id: placement.section_id, status: 'active', enrolled_on: new Date()
        });
        await trx('audit_log').insert(auditRow(actor, 'student.created', 'student', id, null,
          { studentNo: data.studentNo, sectionName: data.sectionName, fields: Object.keys(data) }));
        await trx('audit_log').insert(auditRow(actor, 'student.account_created', 'user', userId, null, {
          studentId: id, username: generated.username
        }));
        return {
          username: generated.username, temporaryPassword: generated.temporaryPassword,
          studentName: generated.studentName
        };
      });
      return {
        student: { id, ...data, campusId: actor.activeCampusId, status: 'enrolled', hasPortalAccount: true },
        credentials
      };
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' && /student_no/i.test(error.message ?? '')) {
        error.code = 'STUDENT_NO_CONFLICT';
        error.message = 'Student number is already in use at this campus.';
      }
      throw error;
    }
    return { id, ...data, campusId: actor.activeCampusId, status: 'enrolled' };
  },
  async previewStudentImport(rows, actor) {
    const [sections, studentRows] = await Promise.all([
      this.db('sections as s')
        .join('academic_years as y', 'y.id', 's.academic_year_id')
        .where({ 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
        .select('s.id', 's.name'),
      this.db('students').where({ campus_id: actor.activeCampusId })
        .whereNull('archived_at').select('*')
    ]);
    return studentImportReports(rows, sections, studentRows.map(mapStudent));
  },
  async importStudents(rows, actor) {
    try {
      return await this.db.transaction(async (trx) => {
        const [sections, studentRows] = await Promise.all([
          trx('sections as s')
            .join('academic_years as y', 'y.id', 's.academic_year_id')
            .where({ 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
            .select('s.id', 's.name', 's.academic_year_id'),
          trx('students').where({ campus_id: actor.activeCampusId })
            .whereNull('archived_at').forUpdate().select('*')
        ]);
        const reports = studentImportReports(rows, sections, studentRows.map(mapStudent));
        const eligibleRows = rows.filter((row) =>
          reports.find((report) => report.rowNumber === row.rowNumber)?.eligible);
        await this.assertUserCapacity(actor.orgId, eligibleRows.length, null, trx);
        await this.assertStudentCapacity(actor.orgId, eligibleRows.length, trx);
        const sectionByName = new Map(sections.map((section) => [
          normalizeImportValue(section.name), section
        ]));
        const generatedRows = await Promise.all(eligibleRows.map(async ({ rowNumber, data }) => ({
          rowNumber, data, generated: await generateStudentCredentials(data, async (username) =>
            Boolean(await trx('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first('id')))
        })));
        const credentials = [];
        for (const { rowNumber, data, generated } of generatedRows) {
          const section = sectionByName.get(normalizeImportValue(data.sectionName));
          const id = randomUUID();
          const userId = randomUUID();
          await trx('users').insert({
            id: userId, organization_id: actor.orgId, name: studentName(data),
            username: generated.username, password_hash: generated.passwordHash,
            role: 'student', must_change_password: true, is_active: true
          });
          await trx('user_campuses').insert({
            user_id: userId, campus_id: actor.activeCampusId, is_active: true
          });
          await trx('students').insert({
            id, campus_id: actor.activeCampusId, student_no: data.studentNo,
            user_id: userId, status: 'enrolled',
            given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
            grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
            father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
            gender: data.gender, date_of_birth: data.dateOfBirth ?? null,
            guardian_phone: data.guardianPhone ?? null, previous_school: data.previousSchool ?? null,
            section_name: data.sectionName
          });
          await trx('enrolments').insert({
            id: randomUUID(), student_id: id, academic_year_id: section.academic_year_id,
            section_id: section.id, status: 'active', enrolled_on: addisDate()
          });
          await trx('audit_log').insert(auditRow(actor, 'student.created', 'student', id, null, {
            studentNo: data.studentNo, sectionName: data.sectionName, fields: Object.keys(data)
          }));
          await trx('audit_log').insert(auditRow(actor, 'student.account_created', 'user', userId, null, {
            studentId: id, username: generated.username
          }));
          credentials.push({
            rowNumber, studentNo: data.studentNo, studentName: generated.studentName,
            username: generated.username, temporaryPassword: generated.temporaryPassword
          });
        }
        if (credentials.length) {
          await trx('audit_log').insert(auditRow(actor, 'student.imported',
            'student_import', null, null, {
              createdCount: credentials.length, rowNumbers: credentials.map((item) => item.rowNumber)
            }));
        }
        return { reports, createdCount: credentials.length, credentials };
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' && /student_no/i.test(error.message ?? '')) {
        error.code = 'STUDENT_NO_CONFLICT';
        error.message = 'Student number is already in use at this campus; no import rows were saved.';
      }
      throw error;
    }
  },
  async hasStudents(campusId, ids) {
    const rows = await this.db('students').where({ campus_id: campusId }).whereIn('id', ids).count({ total: '*' }).first();
    return Number(rows.total) === ids.length;
  },
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return (await this.listStudents(actor.activeCampusId)).map((student) => studentForActor(student, actor));
    if (accessible.size === 0) return [];
    const rows = await this.db('students as st')
      .join('enrolments as e', 'e.student_id', 'st.id')
      .join('sections as s', 's.id', 'e.section_id')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
      .where({ 'y.status': 'active' })
      .whereNull('st.archived_at')
      .whereIn('e.section_id', [...accessible])
      .select('st.*', 's.id as section_id', 's.grade_level_id', 's.stream')
      .distinct().orderBy('st.created_at', 'desc').limit(250);
    return rows.map(mapStudent).map((student) => studentForActor(student, actor));
  },
  async updateStudentProfile(studentId, data, actor) {
    const fields = {
      givenNameAm: 'given_name_am', fatherNameAm: 'father_name_am', grandfatherNameAm: 'grandfather_name_am',
      givenNameEn: 'given_name_en', fatherNameEn: 'father_name_en', grandfatherNameEn: 'grandfather_name_en',
      gender: 'gender', dateOfBirth: 'date_of_birth', guardianPhone: 'guardian_phone',
      previousSchool: 'previous_school'
    };
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first();
      if (!student) return null;
      const updates = Object.fromEntries(Object.entries(data).map(([key, value]) => [fields[key], value]));
      await trx('students').where({ id: studentId, campus_id: actor.activeCampusId }).update(updates);
      await trx('audit_log').insert(auditRow(actor, 'student.profile_updated', 'student', studentId,
        null, { fields: Object.keys(data) }));
      return mapStudent({ ...student, ...updates });
    });
  },
  async getStudentSensitiveData(studentId, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at')
        .select('id_number_enc', 'health_notes_enc', 'special_needs_enc', 'allergies_enc').first();
      if (!student) return null;
      const data = {
        idNumber: decryptSensitiveValue(student.id_number_enc, this.sensitiveDataKey),
        healthNotes: decryptSensitiveValue(student.health_notes_enc, this.sensitiveDataKey),
        specialNeeds: decryptSensitiveValue(student.special_needs_enc, this.sensitiveDataKey),
        allergies: decryptSensitiveValue(student.allergies_enc, this.sensitiveDataKey)
      };
      await trx('audit_log').insert(auditRow(actor, 'student.sensitive_data_viewed', 'student', studentId, null, {
        fields: Object.keys(data)
      }));
      return data;
    });
  },
  async updateStudentSensitiveData(studentId, data, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').select('id').first();
      if (!student) return null;
      const updates = {};
      if (Object.hasOwn(data, 'idNumber')) {
        updates.id_number_enc = encryptSensitiveValue(data.idNumber, this.sensitiveDataKey);
        updates.id_number_hash = hashSensitiveIdentifier(data.idNumber, this.sensitiveDataKey);
      }
      if (Object.hasOwn(data, 'healthNotes')) {
        updates.health_notes_enc = encryptSensitiveValue(data.healthNotes, this.sensitiveDataKey);
      }
      if (Object.hasOwn(data, 'specialNeeds')) {
        updates.special_needs_enc = encryptSensitiveValue(data.specialNeeds, this.sensitiveDataKey);
      }
      if (Object.hasOwn(data, 'allergies')) {
        updates.allergies_enc = encryptSensitiveValue(data.allergies, this.sensitiveDataKey);
      }
      await trx('students').where({ id: studentId, campus_id: actor.activeCampusId }).update(updates);
      await trx('audit_log').insert(auditRow(actor, 'student.sensitive_data_updated', 'student', studentId, null, {
        fields: Object.keys(data)
      }));
      const row = await trx('students').where({ id: studentId, campus_id: actor.activeCampusId })
        .select('id_number_enc', 'health_notes_enc', 'special_needs_enc', 'allergies_enc').first();
      return {
        idNumber: decryptSensitiveValue(row.id_number_enc, this.sensitiveDataKey),
        healthNotes: decryptSensitiveValue(row.health_notes_enc, this.sensitiveDataKey),
        specialNeeds: decryptSensitiveValue(row.special_needs_enc, this.sensitiveDataKey),
        allergies: decryptSensitiveValue(row.allergies_enc, this.sensitiveDataKey)
      };
    });
  },
  async listStudentEmergencyContacts(studentId, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      const rows = await trx('student_emergency_contacts').where({
        student_id: studentId, campus_id: actor.activeCampusId
      }).orderBy('priority').orderBy('created_at');
      await trx('audit_log').insert(auditRow(actor, 'student.emergency_contacts_viewed',
        'student', studentId, null, { count: rows.length }));
      return rows.map((row) => ({
        id: row.id, studentId, name: decryptSensitiveValue(row.contact_name_enc, this.sensitiveDataKey),
        phone: decryptSensitiveValue(row.phone_enc, this.sensitiveDataKey),
        relationship: row.relationship, priority: row.priority, createdAt: row.created_at
      }));
    });
  },
  async addStudentEmergencyContact(studentId, data, actor) {
    const id = randomUUID();
    const contactNameEnc = encryptSensitiveValue(data.name, this.sensitiveDataKey);
    const phoneEnc = encryptSensitiveValue(data.phone, this.sensitiveDataKey);
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      await trx('student_emergency_contacts').insert({
        id, campus_id: actor.activeCampusId, student_id: studentId,
        contact_name_enc: contactNameEnc, phone_enc: phoneEnc,
        relationship: data.relationship, priority: data.priority, created_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.emergency_contact_added',
        'student_emergency_contact', id, null, {
          studentId, fields: ['name', 'phone', 'relationship', 'priority'], priority: data.priority
        }));
      const row = await trx('student_emergency_contacts').where({ id }).first();
      return {
        id, studentId, name: decryptSensitiveValue(row.contact_name_enc, this.sensitiveDataKey),
        phone: decryptSensitiveValue(row.phone_enc, this.sensitiveDataKey),
        relationship: row.relationship, priority: row.priority, createdAt: row.created_at
      };
    });
  },
  async removeStudentEmergencyContact(studentId, contactId, actor) {
    return this.db.transaction(async (trx) => {
      const contact = await trx('student_emergency_contacts').where({
        id: contactId, student_id: studentId, campus_id: actor.activeCampusId
      }).first('id');
      if (!contact) return false;
      await trx('student_emergency_contacts').where({ id: contactId }).delete();
      await trx('audit_log').insert(auditRow(actor, 'student.emergency_contact_removed',
        'student_emergency_contact', contactId, null, { studentId }));
      return true;
    });
  },
  async listStudentGuardians(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_guardians as sg')
      .join('guardians as g', 'g.id', 'sg.guardian_id')
      .where({ 'sg.student_id': studentId, 'g.organization_id': actor.orgId })
      .select(
        'g.id', 'g.given_name_am', 'g.father_name_am', 'g.grandfather_name_am',
        'g.given_name_en', 'g.father_name_en', 'g.grandfather_name_en',
        'g.phone', 'g.email', 'g.user_id', 'sg.relationship', 'sg.is_primary', 'sg.is_verified',
        'sg.can_view_results', 'sg.can_view_fees'
      );
    return rows.map(mapStudentGuardian);
  },
  async listStudentCommendations(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_commendations').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('recorded_on', 'desc').orderBy('created_at', 'desc');
    return rows.map(mapStudentCommendation);
  },
  async createStudentCommendation(studentId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      await trx('student_commendations').insert({
        id, campus_id: actor.activeCampusId, student_id: studentId,
        recorded_on: data.recordedOn, title_en: data.titleEn, title_am: data.titleAm,
        description_en: data.descriptionEn, description_am: data.descriptionAm,
        created_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.commendation.created',
        'student_commendation', id, null, {
          studentId, recordedOn: data.recordedOn, titleEn: data.titleEn, titleAm: data.titleAm
        }));
      return mapStudentCommendation(await trx('student_commendations').where({ id }).first());
    });
  },
  async addStudentGuardian(studentId, data, actor) {
    const guardianId = randomUUID();
    await this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first('id');
      if (!student) {
        const error = new Error('Student is outside the active campus.');
        error.code = 'CAMPUS_SCOPE_VIOLATION';
        throw error;
      }
      if (data.isPrimary) {
        await trx('student_guardians').where({ student_id: studentId }).update({ is_primary: false });
      }
      await trx('guardians').insert({
        id: guardianId, organization_id: actor.orgId,
        given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
        grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
        father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
        phone: data.phone, email: data.email ?? null
      });
      await trx('student_guardians').insert({
        student_id: studentId, guardian_id: guardianId, relationship: data.relationship,
        is_primary: data.isPrimary, is_verified: false, can_view_results: false, can_view_fees: false
      });
      await trx('audit_log').insert(auditRow(actor, 'student.guardian_linked', 'student', studentId,
        null, { guardianId, relationship: data.relationship, isPrimary: data.isPrimary }));
    });
    return {
      id: guardianId, ...data, email: data.email ?? null, isVerified: false,
      canViewResults: false, canViewFees: false
    };
  },
  async removeStudentGuardian(studentId, guardianId, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return false;
      const link = await trx('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .where({
          'sg.student_id': studentId, 'sg.guardian_id': guardianId,
          'g.organization_id': actor.orgId
        }).first('sg.relationship');
      if (!link) return false;
      await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).delete();
      await trx('audit_log').insert(auditRow(actor, 'student.guardian_unlinked', 'student', studentId,
        null, { guardianId, relationship: link.relationship }));
      return true;
    });
  },
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return (await this.listStudents(actor.activeCampusId)).map((student) => studentForActor(student, actor));
    if (accessible.size === 0) return [];
    const query = this.db('students as st')
      .join('enrolments as e', 'e.student_id', 'st.id')
      .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
      .whereNull('st.archived_at')
      .whereIn('e.section_id', [...accessible])
      .select('st.*').distinct().orderBy('st.created_at', 'desc').limit(250);
    return (await query).map(mapStudent).map((student) => studentForActor(student, actor));
  },
  async setStudentIdPattern(pattern, actor) {
    const campus = await this.db('campuses').where({ id: actor.activeCampusId }).first();
    if (!campus) throw campusScopeError('Campus is not available.');
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId }).update({ student_id_pattern: pattern });
      await trx('audit_log').insert(auditRow(actor, 'admission.student_id_pattern_updated', 'campus', actor.activeCampusId, { pattern: campus.student_id_pattern }, { pattern }));
    });
    return { pattern };
  },
  async storeStudentDocument(studentId, documentType, originalName, mimeType, content, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) throw campusScopeError('Student is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content) ||
      (documentType === 'photo' && !['image/jpeg', 'image/png'].includes(mimeType))) {
      throw invalidDocument('The student document content does not match its declared file type.');
    }
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, student_id: studentId, document_type: documentType,
      original_name: safeFilename(originalName), mime_type: mimeType, size_bytes: content.length,
      storage_key: randomUUID(), sha256: createHash('sha256').update(content).digest('hex'),
      uploaded_by: actor.sub
    };
    const filePath = path.join(this.privateDocumentsDir, row.storage_key);
    await mkdir(this.privateDocumentsDir, { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    try {
      await this.db.transaction(async (trx) => {
        await this.assertStorageCapacity(actor.orgId, content.length, 0, trx);
        await trx('student_documents').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'student.document_uploaded',
          'student_document', id, null, {
            studentId, documentType, sizeBytes: content.length, sha256: row.sha256
          }));
      });
    } catch (error) {
      try {
        await unlink(filePath);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Student document metadata write and private-file cleanup both failed.');
      }
      throw error;
    }
    return mapStudentDocument(row);
  },
  async listStudentDocuments(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_documents').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    await this.appendAudit(actor, 'student.documents_viewed', 'student', studentId, null, { count: rows.length });
    return rows.map(mapStudentDocument);
  },
  async getStudentDocument(studentId, documentId, actor) {
    const row = await this.db('student_documents as d')
      .join('students as s', 's.id', 'd.student_id')
      .where({
        'd.id': documentId, 'd.student_id': studentId,
        'd.campus_id': actor.activeCampusId, 's.campus_id': actor.activeCampusId
      }).whereNull('s.archived_at').select('d.*').first();
    if (!row) return null;
    await this.appendAudit(actor, 'student.document_downloaded', 'student_document', documentId, null, { studentId });
    const filePath = path.join(this.privateDocumentsDir, path.basename(row.storage_key));
    return { document: mapStudentDocument(row), content: await readFile(filePath) };
  },
  async createStudentTransferPackage(studentId, data, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const consent = await this.db('student_documents').where({
      id: data.consentDocumentId, student_id: studentId,
      campus_id: actor.activeCampusId, document_type: 'transfer_consent'
    }).first('id');
    if (!consent) throw setupConflict('Upload the guardian-signed transfer consent document before requesting approval.');
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, student_id: studentId,
      recipient_school: data.recipientSchool, guardian_name: data.guardianName,
      guardian_relationship: data.guardianRelationship, consent_recorded_on: data.consentRecordedOn,
      consent_document_id: consent.id, status: 'pending', created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('student_transfer_packages').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'student.transfer_package_requested',
        'student_transfer_package', id, null, {
          studentId, recipientSchool: row.recipient_school, consentRecordedOn: row.consent_recorded_on
        }));
    });
    return mapStudentTransferPackage(row);
  },
  async listStudentTransferPackages(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_transfer_packages').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    return rows.map(mapStudentTransferPackage);
  },
  async approveStudentTransferPackage(packageId, tokenHash, actor) {
    return this.db.transaction(async (trx) => {
      const item = await trx('student_transfer_packages').where({
        id: packageId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!item) return null;
      if (!['pending', 'approved'].includes(item.status)) throw setupConflict('Only pending or approved transfer packages can receive a transfer link.');
      const expiresAt = new Date(Date.now() + 72 * 60 * 60_000);
      await trx('student_transfer_packages').where({ id: packageId }).update({
        status: 'approved', share_token_hash: tokenHash, expires_at: expiresAt,
        approved_by: actor.sub, approved_at: new Date()
      });
      await trx('audit_log').insert(auditRow(actor,
        item.status === 'pending' ? 'student.transfer_package_approved' : 'student.transfer_link_reissued',
        'student_transfer_package', packageId, { status: item.status }, {
          status: 'approved', expiresAt: expiresAt.toISOString()
        }));
      return mapStudentTransferPackage({
        ...item, status: 'approved', share_token_hash: tokenHash,
        expires_at: expiresAt, approved_by: actor.sub, approved_at: new Date()
      });
    });
  },
  async getStudentTransferPackageByTokenHash(tokenHash) {
    return this.db.transaction(async (trx) => {
      const item = await trx('student_transfer_packages as p')
        .join('students as s', 's.id', 'p.student_id')
        .join('campuses as c', 'c.id', 'p.campus_id')
        .join('organizations as o', 'o.id', 'c.organization_id')
        .where({ 'p.share_token_hash': tokenHash, 'p.status': 'approved' })
        .where('p.expires_at', '>', new Date())
        .whereNull('s.archived_at')
        .select('p.*', 'c.name as source_campus_name', 'o.name as source_school_name',
          's.student_no', 's.given_name_am', 's.father_name_am', 's.grandfather_name_am',
          's.given_name_en', 's.father_name_en', 's.grandfather_name_en',
          's.gender', 's.date_of_birth', 's.previous_school').first();
      if (!item) return null;
      const historyRows = await trx('enrolments as e')
        .join('academic_years as y', 'y.id', 'e.academic_year_id')
        .join('sections as section', 'section.id', 'e.section_id')
        .join('grade_levels as grade', 'grade.id', 'section.grade_level_id')
        .where({ 'e.student_id': item.student_id, 'y.campus_id': item.campus_id })
        .orderBy('y.start_date')
        .select('y.label_ec as academicYear', 'grade.name_en as grade',
          'section.name as section', 'e.status', 'e.outcome');
      return {
        recipientSchool: item.recipient_school,
        sourceSchool: item.source_school_name || item.source_campus_name,
        student: {
          studentNo: item.student_no, givenNameAm: item.given_name_am,
          fatherNameAm: item.father_name_am, grandfatherNameAm: item.grandfather_name_am,
          givenNameEn: item.given_name_en, fatherNameEn: item.father_name_en,
          grandfatherNameEn: item.grandfather_name_en, gender: item.gender,
          dateOfBirth: item.date_of_birth ? String(item.date_of_birth).slice(0, 10) : null,
          previousSchool: item.previous_school
        },
        guardianConsent: {
          guardianName: item.guardian_name, relationship: item.guardian_relationship,
          recordedOn: String(item.consent_recorded_on).slice(0, 10)
        },
        academicHistory: historyRows
      };
    });
  },
  async changeStudentStatus(studentId, status, reason, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!student) return null;
      if (student.status !== 'enrolled') throw setupConflict('Only an enrolled student can be withdrawn or transferred.');
      const before = { status: student.status, sectionName: student.section_name };
      await trx('students').where({ id: studentId }).update({ status });
      await trx('admissions').where({ student_id: studentId }).update({ status });
      await trx('enrolments').where({
        student_id: studentId, status: 'active'
      }).update({ status: 'withdrawn', left_on: addisDate(), outcome: status });
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status, reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, `student.${status}`, 'student', studentId, before, { status, reason }));
      return mapStudent({ ...student, status });
    });
  },
  async readmitStudent(studentId, { sectionId, reason }, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!student) return null;
      if (student.status !== 'withdrawn') throw setupConflict('Only a withdrawn student can be readmitted.');
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).forUpdate().first();
      const section = year && await trx('sections').where({
        id: sectionId, campus_id: actor.activeCampusId, academic_year_id: year.id
      }).forUpdate().first();
      if (!section) throw campusScopeError('Select a section in the active academic year at this campus.');
      if (section.capacity != null) {
        const count = await trx('enrolments').where({
          section_id: sectionId, academic_year_id: year.id, status: 'active'
        }).count({ total: '*' }).first();
        if (Number(count.total) >= Number(section.capacity)) throw setupConflict('The selected section has reached capacity.');
      }
      const current = await trx('enrolments').where({
        student_id: studentId, academic_year_id: year.id
      }).first();
      if (current) {
        await trx('enrolments').where({ id: current.id }).update({
          section_id: sectionId, status: 'active', enrolled_on: addisDate(), left_on: null, outcome: null
        });
      } else {
        await trx('enrolments').insert({
          id: randomUUID(), student_id: studentId, academic_year_id: year.id,
          section_id: sectionId, status: 'active', enrolled_on: addisDate()
        });
      }
      const before = { status: student.status, sectionName: student.section_name };
      await trx('students').where({ id: studentId }).update({ status: 'enrolled', section_name: section.name });
      await trx('admissions').where({ student_id: studentId }).update({ status: 'enrolled' });
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status: 'enrolled', reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.readmitted', 'student', studentId, before, {
        status: 'enrolled', sectionId, reason
      }));
      return mapStudent({ ...student, status: 'enrolled', section_name: section.name });
    });
  },
  async listStudentEnrollmentHistory(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s active section.');
    }
    const rows = await this.db('enrolments as e')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .join('sections as s', 's.id', 'e.section_id')
      .join('grade_levels as g', 'g.id', 's.grade_level_id')
      .where({ 'e.student_id': studentId, 's.campus_id': actor.activeCampusId, 'y.campus_id': actor.activeCampusId })
      .orderBy('y.start_date', 'desc')
      .select('e.id', 'e.academic_year_id as academicYearId', 'y.label_ec as academicYear',
        'g.id as gradeLevelId', 'g.name_en as gradeNameEn', 'g.name_am as gradeNameAm',
        's.id as sectionId', 's.name as sectionName', 'e.status', 'e.enrolled_on as enrolledOn',
        'e.left_on as leftOn', 'e.outcome');
    return rows.map((row) => ({
      ...row,
      enrolledOn: row.enrolledOn ? String(row.enrolledOn).slice(0, 10) : null,
      leftOn: row.leftOn ? String(row.leftOn).slice(0, 10) : null
    }));
  },
  async transferStudentSection(studentId, { sectionId, reason }, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId, status: 'enrolled'
      }).whereNull('archived_at').forUpdate().first();
      if (!student) {
        const exists = await trx('students').where({
          id: studentId, campus_id: actor.activeCampusId
        }).whereNull('archived_at').first('id');
        if (exists) throw setupConflict('Only enrolled students can transfer sections.');
        return null;
      }
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).first('id');
      const current = year && await trx('enrolments').where({
        student_id: studentId, academic_year_id: year.id, status: 'active'
      }).forUpdate().first();
      const destination = year && await trx('sections').where({
        id: sectionId, campus_id: actor.activeCampusId, academic_year_id: year.id, is_active: true
      }).forUpdate().first();
      if (!year || !current || !destination) {
        throw campusScopeError('Select a section in the active academic year at this campus.');
      }
      if (current.section_id === destination.id) throw setupConflict('Student is already assigned to this section.');
      if (destination.capacity != null) {
        const total = await trx('enrolments').where({
          section_id: destination.id, academic_year_id: year.id, status: 'active'
        }).count({ total: '*' }).first();
        if (Number(total.total) >= Number(destination.capacity)) throw setupConflict('The selected section has reached capacity.');
      }
      await trx('enrolments').where({ id: current.id }).update({ section_id: destination.id });
      await trx('students').where({ id: studentId }).update({ section_name: destination.name });
      const transferId = randomUUID();
      await trx('student_section_transfers').insert({
        id: transferId, campus_id: actor.activeCampusId, student_id: studentId,
        academic_year_id: year.id, from_section_id: current.section_id,
        to_section_id: destination.id, reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.section_transferred', 'student',
        studentId, { sectionId: current.section_id }, { sectionId: destination.id, reason }));
      return mapStudent({ ...student, section_name: destination.name });
    });
  },
  async listStudentSectionTransfers(studentId, actor) {
    const exists = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!exists) return null;
    const rows = await this.db('student_section_transfers as tr')
      .join('sections as source', 'source.id', 'tr.from_section_id')
      .join('sections as destination', 'destination.id', 'tr.to_section_id')
      .where({ 'tr.campus_id': actor.activeCampusId, 'tr.student_id': studentId })
      .orderBy('tr.created_at', 'desc')
      .select('tr.id', 'tr.student_id as studentId', 'tr.reason', 'tr.created_at as createdAt',
        'source.name as fromSection', 'destination.name as toSection');
    return rows;
  },
  async listStudentDisciplineRecords(studentId, actor) {
    const exists = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!exists) return null;
    const rows = await this.db('student_discipline_records').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('recorded_on', 'desc').orderBy('created_at', 'desc');
    await this.appendAudit(actor, 'student.discipline_viewed', 'student', studentId, null, { count: rows.length });
    return rows.map((row) => mapStudentDisciplineRecord(row, this.sensitiveDataKey));
  },
  async createStudentDisciplineRecord(studentId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      const row = {
        id, campus_id: actor.activeCampusId, student_id: studentId,
        recorded_on: data.recordedOn, category: data.category,
        details_enc: encryptSensitiveValue(data.details, this.sensitiveDataKey),
        action_taken_enc: encryptSensitiveValue(data.actionTaken ?? null, this.sensitiveDataKey),
        recorded_by: actor.sub
      };
      await trx('student_discipline_records').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'student.discipline_recorded',
        'student_discipline_record', id, null, {
          studentId, recordedOn: data.recordedOn, category: data.category
        }));
      return mapStudentDisciplineRecord(row, this.sensitiveDataKey);
    });
  },
  async advanceStudent(studentId, { outcome, sectionId, reason, overrideReason }, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first();
      if (!student) return null;
      if (student.status !== 'enrolled') {
        throw setupConflict('Only an enrolled student can progress to a new academic year.');
      }
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).forUpdate().first();
      if (!year) throw setupConflict('Activate the destination academic year before recording progression.');
      const currentEnrollment = await trx('enrolments').where({
        student_id: studentId, academic_year_id: year.id
      }).first('id');
      if (currentEnrollment) throw setupConflict('The student already has an enrolment in the active academic year.');
      const previous = await trx('enrolments as e')
        .join('academic_years as y', 'y.id', 'e.academic_year_id')
        .join('sections as s', 's.id', 'e.section_id')
        .join('grade_levels as g', 'g.id', 's.grade_level_id')
        .where({
          'e.student_id': studentId, 'e.status': 'completed',
          'y.campus_id': actor.activeCampusId, 'y.status': 'closed', 's.campus_id': actor.activeCampusId
        })
        .orderBy('y.end_date', 'desc')
        .forUpdate()
        .first('e.id', 'e.academic_year_id', 's.grade_level_id as source_grade_level_id',
          's.stream as source_stream', 'g.sort_order as source_sort_order');
      if (!previous) throw setupConflict('A completed enrolment from a closed academic year is required.');

      if (outcome === 'graduated' && Number(previous.source_sort_order) !== 12) {
        throw setupConflict('Only Grade 12 students can be recorded as graduates.');
      }

      let section = null;
      if (outcome !== 'graduated') {
        section = await trx('sections').where({
          id: sectionId, campus_id: actor.activeCampusId, academic_year_id: year.id
        }).forUpdate().first();
        if (!section) throw campusScopeError('Select a section in the active academic year at this campus.');
        const destinationGrade = await trx('grade_levels').where({
          id: section.grade_level_id, campus_id: actor.activeCampusId
        }).first('sort_order');
        const expectedOrder = Number(previous.source_sort_order) + (outcome === 'promoted' ? 1 : 0);
        if (!destinationGrade || Number(destinationGrade.sort_order) !== expectedOrder) {
          throw setupConflict(outcome === 'promoted'
            ? 'Promotion must advance exactly one grade.'
            : 'Repetition must keep the student in the same grade.');
        }
        if (outcome === 'promoted') {
          const eligibility = await this.evaluateStudentProgression(studentId, actor);
          const overrideAllowed = ['owner_director', 'principal', 'system_admin'].includes(actor.role) &&
            Boolean(overrideReason?.trim());
          if (eligibility.status !== 'eligible' && !overrideAllowed) {
            throw setupConflict(`${eligibility.reason} A principal must configure the rule/results or provide an audited override reason.`);
          }
        }
        if (section.capacity != null) {
          const count = await trx('enrolments').where({
            section_id: section.id, academic_year_id: year.id, status: 'active'
          }).count({ total: '*' }).first();
          if (Number(count.total) >= Number(section.capacity)) {
            throw setupConflict('The selected section has reached capacity.');
          }
        }
      }

      const before = { status: student.status, sectionName: student.section_name };
      await trx('enrolments').where({ id: previous.id }).update({ outcome });
      if (outcome === 'graduated') {
        await trx('students').where({ id: studentId, campus_id: actor.activeCampusId })
          .update({ status: 'graduated', section_name: null });
      } else {
        await trx('enrolments').insert({
          id: randomUUID(), student_id: studentId, academic_year_id: year.id,
          section_id: section.id, status: 'active', enrolled_on: addisDate()
        });
        await trx('students').where({ id: studentId, campus_id: actor.activeCampusId })
          .update({ section_name: section.name });
      }
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status: outcome, reason, recorded_by: actor.sub
      });
      const after = {
        status: outcome === 'graduated' ? 'graduated' : 'enrolled',
        outcome, fromAcademicYearId: previous.academic_year_id,
        toAcademicYearId: outcome === 'graduated' ? null : year.id,
        sectionId: section?.id ?? null, reason,
        overrideReason: overrideReason ?? null
      };
      await trx('audit_log').insert(auditRow(actor, `student.${outcome}`, 'student', studentId, before, after));
      return mapStudent({
        ...student, status: after.status,
        section_name: outcome === 'graduated' ? null : section.name
      });
    });
  },
  async transferStudentOut(studentId, reason, actor) {
    return this.changeStudentStatus(studentId, 'transferred_out', reason, actor);
  },
  async getStudentTransferRecord(campusId, studentId) {
    const [student, history, campus] = await Promise.all([
      this.db('students').where({ id: studentId, campus_id: campusId }).first(),
      this.db('student_status_history').where({
        student_id: studentId, campus_id: campusId, status: 'transferred_out'
      }).orderBy('created_at', 'desc').first(),
      this.db('campuses').where({ id: campusId }).first()
    ]);
    return student && history && campus ? {
      student: mapStudent(student),
      history: { status: history.status, reason: history.reason, createdAt: history.created_at },
      campus: { id: campus.id, name: campus.name, address: campus.address }
    } : null;
  }
};
