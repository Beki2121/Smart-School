import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addisDate, auditRow, campusScopeError, setupConflict } from '../shared.js';
import { formatStaffName, mapStaff } from '../staff.mappers.js';
import { proratedLeaveEntitlementHalfDays } from '../hr-leave.js';

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const maximumDocumentSize = 5 * 1024 * 1024;
const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase();
const staffNameKey = (staff) => [
  staff.givenNameEn, staff.fatherNameEn, staff.grandfatherNameEn, staff.jobTitle
].map(normalize).join('\u0000');

function hrError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function mapDocument(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    staffId: row.staff_id, category: row.category, originalName: row.original_name,
    mimeType: row.mime_type, sizeBytes: row.size_bytes, sha256: row.sha256,
    uploadedBy: row.uploaded_by, createdAt: row.created_at
  };
}

function safeFilename(value) {
  return String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'document';
}

function dateOnly(value) {
  if (value == null) return null;
  return value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).slice(0, 10);
}

function localDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function mapContract(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    staffId: row.staff_id, contractType: row.contract_type,
    startsOn: dateOnly(row.starts_on), endsOn: dateOnly(row.ends_on),
    renewalDueOn: dateOnly(row.renewal_due_on), status: row.status, notes: row.notes,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function mapLeaveType(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    name: row.name, kind: row.kind,
    annualEntitlementHalfDays: row.annual_entitlement_half_days,
    carryOverLimitHalfDays: row.carry_over_limit_half_days,
    isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapLeaveBalance(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    staffId: row.staff_id, leaveTypeId: row.leave_type_id, year: row.year,
    entitledHalfDays: row.entitled_half_days, carryOverHalfDays: row.carry_over_half_days,
    usedHalfDays: row.used_half_days,
    remainingHalfDays: Math.max(0,
      row.entitled_half_days + row.carry_over_half_days - row.used_half_days),
    leaveType: row.leave_type_name
  };
}

function leaveBalanceError() {
  const error = setupConflict('Insufficient leave balance for this request.');
  error.code = 'LEAVE_BALANCE_INSUFFICIENT';
  return error;
}

export const mysqlHrBundle = {
  async addHrNotifications(trx, actor, sourceType, sourceId, title, body, extraUserIds = []) {
    const recipients = await trx('user_campuses as uc')
      .join('users as u', 'u.id', 'uc.user_id')
      .where({
        'uc.campus_id': actor.activeCampusId, 'uc.is_active': true, 'u.is_active': true
      }).whereIn('u.role', ['hr_admin', 'owner_director', 'principal', 'system_admin'])
      .select('u.id');
    const recipientIds = new Set([...recipients.map(({ id }) => id), ...extraUserIds.filter(Boolean)]);
    const existing = new Set(recipientIds.size ? (await trx('user_notifications').where({
      campus_id: actor.activeCampusId, source_type: sourceType, source_id: sourceId
    }).whereIn('user_id', [...recipientIds]).pluck('user_id')) : []);
    const rows = [...recipientIds].filter((id) => !existing.has(id)).map((userId) => ({
      id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
      user_id: userId, source_type: sourceType, source_id: sourceId,
      title_en: title, title_am: title, body_en: body, body_am: body
    }));
    if (rows.length) {
      await trx('user_notifications')
        .insert(rows).onConflict(['user_id', 'source_type', 'source_id']).ignore();
    }
  },
  async findHrStaff(staffId, actor, includeArchived = false, query = this.db) {
    const builder = query('staff').where({
      id: staffId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    });
    if (!includeArchived) builder.whereNull('archived_at');
    return builder.first();
  },
  async updateHrStaff(staffId, data, actor) {
    return this.db.transaction(async (trx) => {
      const staff = await trx('staff').where({
        id: staffId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first();
      if (!staff) return null;
      if (data.departmentId && !await trx('departments').where({
        id: data.departmentId, campus_id: actor.activeCampusId
      }).first('id')) throw campusScopeError('Department is outside the active campus.');
      const before = mapStaff(staff);
      const update = {};
      const columns = {
        departmentId: 'department_id', givenNameEn: 'given_name_en',
        fatherNameEn: 'father_name_en', grandfatherNameEn: 'grandfather_name_en',
        givenNameAm: 'given_name_am', fatherNameAm: 'father_name_am',
        grandfatherNameAm: 'grandfather_name_am', jobTitle: 'job_title',
        qualification: 'qualification', employmentStatus: 'employment_status', hiredOn: 'hired_on'
      };
      for (const [key, column] of Object.entries(columns)) {
        if (Object.hasOwn(data, key)) update[column] = data[key];
      }
      await trx('staff').where({ id: staffId, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update(update);
      const updated = await trx('staff').where({ id: staffId }).first();
      await trx('audit_log').insert(auditRow(actor, 'hr.staff_updated', 'staff', staffId,
        before, mapStaff(updated)));
      return mapStaff(updated);
    });
  },
  async archiveHrStaff(staffId, actor) {
    return this.db.transaction(async (trx) => {
      const staff = await trx('staff').where({
        id: staffId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first();
      if (!staff) return null;
      const archivedAt = new Date();
      await trx('staff').where({ id: staffId, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update({ archived_at: archivedAt });
      const count = Number((await trx('staff_documents').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, staff_id: staffId
      }).count({ total: '*' }).first()).total);
      await trx('audit_log').insert(auditRow(actor, 'hr.staff_archived', 'staff', staffId,
        { archivedAt: staff.archived_at, employmentStatus: staff.employment_status },
        { archivedAt, retainedDocuments: count }));
      return { id: staffId, archivedAt };
    });
  },
  async previewHrStaffImport(rows, actor) {
    const existingRows = await this.db('staff').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').select(
      'given_name_en', 'father_name_en', 'grandfather_name_en', 'job_title'
    );
    const existing = new Set(existingRows.map((row) => staffNameKey({
      givenNameEn: row.given_name_en, fatherNameEn: row.father_name_en,
      grandfatherNameEn: row.grandfather_name_en, jobTitle: row.job_title
    })));
    const seen = new Set();
    const departmentIds = [...new Set(rows.map(({ data }) => data.departmentId).filter(Boolean))];
    const departments = departmentIds.length
      ? new Set(await this.db('departments').where({
        campus_id: actor.activeCampusId
      }).whereIn('id', departmentIds).pluck('id')) : new Set();
    return rows.map(({ rowNumber, data }) => {
      const errors = [];
      if (data.departmentId && !departments.has(data.departmentId)) {
        errors.push({ field: 'departmentId', message: 'Department is outside the active campus.' });
      }
      const key = staffNameKey(data);
      if (existing.has(key) || seen.has(key)) errors.push({
        field: 'givenNameEn', message: 'A matching staff profile already exists.'
      });
      seen.add(key);
      return { rowNumber, eligible: errors.length === 0, errors, warnings: [] };
    });
  },
  async importHrStaff(rows, actor) {
    try {
      return await this.db.transaction(async (trx) => {
        await trx('staff').where({ organization_id: actor.orgId,
          campus_id: actor.activeCampusId }).whereNull('archived_at').forUpdate().select('id');
        const reports = await this.previewHrStaffImport(rows, actor);
        const eligible = rows.filter(({ rowNumber }) =>
          reports.find((report) => report.rowNumber === rowNumber)?.eligible);
        await this.assertStaffCapacity(actor.orgId, eligible.length, trx);
        const created = [];
        for (const { rowNumber, data } of eligible) {
          const id = randomUUID();
          const row = {
            id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
            user_id: null, department_id: data.departmentId ?? null,
            given_name_en: data.givenNameEn, father_name_en: data.fatherNameEn,
            grandfather_name_en: data.grandfatherNameEn, given_name_am: data.givenNameAm,
            father_name_am: data.fatherNameAm, grandfather_name_am: data.grandfatherNameAm,
            job_title: data.jobTitle, qualification: data.qualification ?? '',
            employment_status: data.employmentStatus ?? 'active', hired_on: data.hiredOn ?? null
          };
          await trx('staff').insert(row);
          await trx('audit_log').insert(auditRow(actor, 'hr.staff_imported', 'staff', id, null, {
            rowNumber, fields: Object.keys(data)
          }));
          created.push({ rowNumber, staff: mapStaff(row) });
        }
        if (created.length) await trx('audit_log').insert(auditRow(actor,
          'hr.staff_import_committed', 'staff_import', null, null, {
            createdCount: created.length
          }));
        return { reports, createdCount: created.length, created };
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('A matching staff profile already exists.');
      throw error;
    }
  },
  async storeStaffDocument(staffId, category, originalName, mimeType, content, actor) {
    const staff = await this.findHrStaff(staffId, actor);
    if (!staff) throw campusScopeError('Staff profile is outside the active campus.');
    if (!Buffer.isBuffer(content) || !content.length || content.length > maximumDocumentSize ||
        !allowedTypes.has(mimeType)) {
      throw hrError('INVALID_DOCUMENT', 'Upload a non-empty PDF, JPEG, or PNG file no larger than 5 MB.');
    }
    const id = randomUUID();
    const row = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId, staff_id: staffId,
      category, original_name: safeFilename(originalName), mime_type: mimeType,
      size_bytes: content.length, storage_key: randomUUID(),
      sha256: createHash('sha256').update(content).digest('hex'), uploaded_by: actor.sub
    };
    const directory = this.privateDocumentsDir;
    const filePath = path.join(directory, row.storage_key);
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    try {
      await this.db.transaction(async (trx) => {
        await this.assertStorageCapacity(actor.orgId, content.length, 0, trx);
        await trx('staff_documents').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'hr.staff_document_uploaded',
          'staff_document', id, null, {
            staffId, category, sizeBytes: content.length, sha256: row.sha256
          }));
      });
    } catch (error) {
      try { await unlink(filePath); }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError],
          'Staff document metadata write and private-file cleanup both failed.');
      }
      throw error;
    }
    return mapDocument(row);
  },
  async listStaffDocuments(staffId, actor) {
    if (!await this.findHrStaff(staffId, actor, true)) return null;
    const rows = await this.db('staff_documents').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, staff_id: staffId
    }).orderBy('created_at', 'desc').limit(200);
    await this.appendAudit(actor, 'hr.staff_documents_viewed', 'staff', staffId, null, {
      count: rows.length
    });
    return rows.map(mapDocument);
  },
  async getStaffDocument(staffId, documentId, actor) {
    const row = await this.db('staff_documents').where({
      id: documentId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      staff_id: staffId
    }).first();
    if (!row) return null;
    await this.appendAudit(actor, 'hr.staff_document_downloaded', 'staff_document',
      documentId, null, { staffId, category: row.category });
    const filePath = path.join(this.privateDocumentsDir, path.basename(row.storage_key));
    return { document: mapDocument(row), content: await readFile(filePath) };
  },
  async listHrContracts(actor, staffId) {
    if (staffId && !await this.findHrStaff(staffId, actor, true)) return null;
    const query = this.db('hr_contracts').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNull('archived_at');
    if (staffId) query.where({ staff_id: staffId });
    const rows = await query.orderBy('starts_on').limit(500);
    return rows.map(mapContract);
  },
  async listHrContractsExpiring(actor, throughDate) {
    const rows = await this.db('hr_contracts').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'active'
    }).whereNull('archived_at').whereNotNull('ends_on').where('ends_on', '<=', throughDate)
      .orderBy('ends_on').limit(500);
    return rows.map(mapContract);
  },
  async createHrContract(staffId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const staff = await trx('staff').where({
        id: staffId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first('id');
      if (!staff) return null;
      const overlap = await trx('hr_contracts').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        staff_id: staffId, status: 'active'
      }).whereNull('archived_at')
        .andWhere((builder) => {
          if (data.endsOn) builder.whereNull('starts_on').orWhere('starts_on', '<=', data.endsOn);
        })
        .andWhere((builder) => builder.whereNull('ends_on')
          .orWhere('ends_on', '>=', data.startsOn)).forUpdate().first('id');
      if (overlap) throw setupConflict('This staff member already has an overlapping active contract.');
      const row = {
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        staff_id: staffId, contract_type: data.contractType, starts_on: data.startsOn,
        ends_on: data.endsOn ?? null, renewal_due_on: data.renewalDueOn ?? null,
        status: 'active', notes: data.notes ?? '', created_by: actor.sub
      };
      await trx('hr_contracts').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'hr.contract_created',
        'hr_contract', id, null, row));
      return mapContract(row);
    });
  },
  async renewHrContract(contractId, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('hr_contracts').where({
        id: contractId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        status: 'active'
      }).whereNull('archived_at').forUpdate().first();
      if (!row) return null;
      if (row.ends_on && data.newEndDate <= dateOnly(row.ends_on)) {
        throw setupConflict('A renewal end date must be later than the current end date.');
      }
      const id = randomUUID();
      await trx('hr_contract_renewals').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        contract_id: contractId, previous_end_date: row.ends_on,
        new_end_date: data.newEndDate, renewed_by: actor.sub
      });
      await trx('hr_contracts').where({ id: contractId }).update({
        ends_on: data.newEndDate, renewal_due_on: null, updated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(actor, 'hr.contract_renewed',
        'hr_contract', contractId, { endsOn: dateOnly(row.ends_on) }, {
          endsOn: data.newEndDate, renewalId: id
        }));
      const updated = await trx('hr_contracts').where({ id: contractId }).first();
      return {
        contract: mapContract(updated),
        renewal: {
          id, organizationId: actor.orgId, campusId: actor.activeCampusId,
          contractId, previousEndDate: dateOnly(row.ends_on),
          newEndDate: data.newEndDate, renewedBy: actor.sub
        }
      };
    });
  },
  async listHrContractRenewals(contractId, actor) {
    const contract = await this.db('hr_contracts').where({
      id: contractId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first('id');
    if (!contract) return null;
    const rows = await this.db('hr_contract_renewals').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, contract_id: contractId
    }).orderBy('renewed_at').limit(100);
    return rows.map((row) => ({
      id: row.id, contractId: row.contract_id, previousEndDate: dateOnly(row.previous_end_date),
      newEndDate: dateOnly(row.new_end_date), renewedBy: row.renewed_by, renewedAt: row.renewed_at
    }));
  },
  async listHrLeaveTypes(actor) {
    const rows = await this.db('hr_leave_types').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('name').limit(200);
    return rows.map(mapLeaveType);
  },
  async createHrLeaveType(data, actor) {
    const id = randomUUID();
    try {
      const row = {
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        name: data.name, kind: data.kind,
        annual_entitlement_half_days: data.annualEntitlementHalfDays,
        carry_over_limit_half_days: data.carryOverLimitHalfDays, is_active: data.isActive
      };
      await this.db.transaction(async (trx) => {
        await trx('hr_leave_types').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'hr.leave_type_created',
          'hr_leave_type', id, null, row));
      });
      return mapLeaveType(row);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('A leave type with this name already exists.');
      throw error;
    }
  },
  async setHrLeaveBalance(data, actor) {
    return this.db.transaction(async (trx) => {
      const staff = await this.findHrStaff(data.staffId, actor, true, trx);
      if (!staff) {
        throw campusScopeError('Staff or leave type is outside the active campus.');
      }
      const leaveType = await trx('hr_leave_types').where({
        id: data.leaveTypeId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!leaveType) throw campusScopeError('Staff or leave type is outside the active campus.');
      const prior = await trx('hr_leave_balances').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        staff_id: data.staffId, leave_type_id: data.leaveTypeId, year: data.year
      }).forUpdate().first();
      const before = prior ? mapLeaveBalance(prior) : null;
      const entitledHalfDays = data.entitledHalfDays ?? proratedLeaveEntitlementHalfDays(
        leaveType.annual_entitlement_half_days, dateOnly(staff.hired_on), data.year
      );
      const carryOverHalfDays = Math.min(data.carryOverHalfDays,
        leaveType.carry_over_limit_half_days);
      if ((prior?.used_half_days ?? 0) > entitledHalfDays + carryOverHalfDays) {
        throw setupConflict('The updated entitlement cannot be lower than leave already used.');
      }
      const values = {
        entitled_half_days: entitledHalfDays,
        carry_over_half_days: carryOverHalfDays,
        updated_at: trx.fn.now()
      };
      let id = prior?.id;
      if (prior) await trx('hr_leave_balances').where({ id: prior.id }).update(values);
      else {
        id = randomUUID();
        await trx('hr_leave_balances').insert({
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          staff_id: data.staffId, leave_type_id: data.leaveTypeId, year: data.year,
          ...values, used_half_days: 0
        });
      }
      const updated = await trx('hr_leave_balances').where({ id }).first();
      const result = mapLeaveBalance({ ...updated, leave_type_name: leaveType.name });
      await trx('audit_log').insert(auditRow(actor, 'hr.leave_balance_set',
        'hr_leave_balance', id, before, result));
      return result;
    });
  },
  async listHrLeaveBalances(actor, staffId) {
    if (staffId && !await this.findHrStaff(staffId, actor, true)) return null;
    const query = this.db('hr_leave_balances as b')
      .join('hr_leave_types as t', 't.id', 'b.leave_type_id')
      .where({
        'b.organization_id': actor.orgId, 'b.campus_id': actor.activeCampusId
      });
    if (staffId) query.where({ 'b.staff_id': staffId });
    const rows = await query.select('b.*', 't.name as leave_type_name')
      .orderBy('b.year', 'desc').limit(500);
    return rows.map(mapLeaveBalance);
  },
  async getApprovedHrLeaveForPeriod(staffId, from, to, actor) {
    if (!await this.findHrStaff(staffId, actor, true)) return null;
    const rows = await this.db('leave_requests as lr')
      .leftJoin('hr_leave_types as lt', 'lt.id', 'lr.leave_type_id')
      .where({
        'lr.organization_id': actor.orgId, 'lr.campus_id': actor.activeCampusId,
        'lr.staff_id': staffId, 'lr.status': 'approved'
      }).where('lr.start_date', '<=', to).where('lr.end_date', '>=', from)
      .select('lr.staff_id', 'lr.leave_type_id', 'lr.start_date', 'lr.end_date',
        'lr.requested_half_days', 'lt.kind').orderBy('lr.start_date').limit(500);
    return rows.map((row) => ({
      staffId: row.staff_id, leaveTypeId: row.leave_type_id,
      kind: row.kind ?? 'unpaid', startDate: dateOnly(row.start_date),
      endDate: dateOnly(row.end_date), requestedHalfDays: row.requested_half_days
    }));
  },
  async getStaffAttendanceForPeriod(staffId, from, to, actor) {
    if (!await this.findHrStaff(staffId, actor, true)) return null;
    const rows = await this.db('staff_attendance').where({
      campus_id: actor.activeCampusId, staff_id: staffId
    }).whereBetween('attendance_date', [from, to]).orderBy('attendance_date').limit(500);
    return rows.map((row) => ({
      id: row.id, staffId: row.staff_id, date: dateOnly(row.attendance_date),
      status: row.status, clockIn: row.clock_in, clockOut: row.clock_out
    }));
  },
  async getHrDashboard(actor) {
    const today = addisDate();
    const throughDate = new Date(`${today}T00:00:00Z`);
    throughDate.setUTCDate(throughDate.getUTCDate() + 30);
    const through = throughDate.toISOString().slice(0, 10);
    const [total, active, leave, contracts] = await Promise.all([
      this.db('staff').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').count({ count: '*' }).first(),
      this.db('staff').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        employment_status: 'active'
      }).whereNull('archived_at').count({ count: '*' }).first(),
      this.db('leave_requests').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'pending'
      }).count({ count: '*' }).first(),
      this.db('hr_contracts').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'active'
      }).whereNull('archived_at').whereBetween('ends_on', [today, through])
        .count({ count: '*' }).first()
    ]);
    const expiringRows = await this.db('hr_contracts').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'active'
    }).whereNull('archived_at').whereBetween('ends_on', [today, through]).select('id', 'ends_on');
    await this.db.transaction(async (trx) => {
      for (const contract of expiringRows) await this.addHrNotifications(
        trx, actor, 'hr_contract_expiry', contract.id, 'Contract expiry reminder',
        `Contract ${contract.id} expires on ${dateOnly(contract.ends_on)}.`
      );
    });
    return {
      totalStaff: Number(total.count), activeStaff: Number(active.count),
      pendingLeaveRequests: Number(leave.count),
      contractsExpiringWithin30Days: Number(contracts.count)
    };
  },
  async listHrVacancies(actor) {
    const rows = await this.db('hr_vacancies').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc').limit(500);
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      departmentId: row.department_id, title: row.title, description: row.description,
      status: row.status, createdBy: row.created_by, createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  },
  async createHrVacancy(data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      if (data.departmentId && !await trx('departments').where({
        id: data.departmentId, campus_id: actor.activeCampusId
      }).first('id')) throw campusScopeError('Department is outside the active campus.');
      const row = {
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        department_id: data.departmentId ?? null, title: data.title,
        description: data.description, status: 'open', created_by: actor.sub
      };
      await trx('hr_vacancies').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'hr.vacancy_created',
        'hr_vacancy', id, null, row));
      return {
        id, organizationId: actor.orgId, campusId: actor.activeCampusId,
        departmentId: row.department_id, title: row.title, description: row.description,
        status: row.status, createdBy: row.created_by
      };
    });
  },
  async listHrApplicants(actor, vacancyId) {
    const query = this.db('hr_applicants').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    });
    if (vacancyId) query.where({ vacancy_id: vacancyId });
    const rows = await query.orderBy('created_at', 'desc').limit(500);
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      vacancyId: row.vacancy_id, givenName: row.given_name, fatherName: row.father_name,
      grandfatherName: row.grandfather_name, email: row.email, phone: row.phone,
      status: row.status, staffId: row.staff_id, createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  },
  async createHrApplicant(vacancyId, data, actor) {
    const id = randomUUID();
    try {
      return await this.db.transaction(async (trx) => {
        const vacancy = await trx('hr_vacancies').where({
          id: vacancyId, organization_id: actor.orgId,
          campus_id: actor.activeCampusId, status: 'open'
        }).forUpdate().first('id');
        if (!vacancy) return null;
        const row = {
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          vacancy_id: vacancyId, given_name: data.givenName, father_name: data.fatherName,
          grandfather_name: data.grandfatherName, email: data.email,
          phone: data.phone, status: 'received'
        };
        await trx('hr_applicants').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'hr.applicant_created',
          'hr_applicant', id, null, row));
        return {
          id, organizationId: actor.orgId, campusId: actor.activeCampusId,
          vacancyId, givenName: data.givenName, fatherName: data.fatherName,
          grandfatherName: data.grandfatherName, email: data.email, phone: data.phone,
          status: 'received', staffId: null
        };
      });
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      return this.db('hr_applicants').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        vacancy_id: vacancyId, email: data.email
      }).first().then((row) => row ? ({
        id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
        vacancyId: row.vacancy_id, givenName: row.given_name, fatherName: row.father_name,
        grandfatherName: row.grandfather_name, email: row.email, phone: row.phone,
        status: row.status, staffId: row.staff_id, createdAt: row.created_at,
        updatedAt: row.updated_at
      }) : null);
    }
  },
  async scheduleHrInterview(applicantId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const applicant = await trx('hr_applicants').where({
        id: applicantId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).whereNotIn('status', ['hired', 'rejected']).forUpdate().first('id');
      if (!applicant) return null;
      const row = {
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        applicant_id: applicantId, scheduled_at: localDateTime(data.scheduledAt),
        notes: data.notes, status: 'scheduled', created_by: actor.sub
      };
      await trx('hr_interviews').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'hr.interview_scheduled',
        'hr_interview', id, null, row));
      await this.addHrNotifications(trx, actor, 'hr_interview_scheduled', id,
        'Interview scheduled', `An interview was scheduled for applicant ${applicantId}.`);
      return {
        id, organizationId: actor.orgId, campusId: actor.activeCampusId,
        applicantId, scheduledAt: localDateTime(data.scheduledAt), notes: data.notes,
        status: 'scheduled', createdBy: actor.sub
      };
    });
  },
  async listHrInterviews(applicantId, actor) {
    const applicant = await this.db('hr_applicants').where({
      id: applicantId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first('id');
    if (!applicant) return null;
    const rows = await this.db('hr_interviews').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId,
      applicant_id: applicantId
    }).orderBy('scheduled_at').limit(100);
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      applicantId: row.applicant_id, scheduledAt: localDateTime(row.scheduled_at),
      notes: row.notes, status: row.status, createdBy: row.created_by,
      createdAt: row.created_at
    }));
  },
  async decideHrApplicant(applicantId, decision, actor) {
    return this.db.transaction(async (trx) => {
      const applicant = await trx('hr_applicants').where({
        id: applicantId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!applicant) return null;
      if (applicant.staff_id && applicant.status === 'hired') return {
        id: applicant.id, organizationId: applicant.organization_id,
        campusId: applicant.campus_id, vacancyId: applicant.vacancy_id,
        givenName: applicant.given_name, fatherName: applicant.father_name,
        grandfatherName: applicant.grandfather_name, email: applicant.email,
        phone: applicant.phone, status: applicant.status, staffId: applicant.staff_id
      };
      if (!['received', 'shortlisted'].includes(applicant.status)) {
        throw setupConflict('This applicant cannot transition from the current status.');
      }
      let staffId = null;
      if (decision.decision === 'hired') {
        const vacancy = await trx('hr_vacancies').where({
          id: applicant.vacancy_id, organization_id: actor.orgId,
          campus_id: actor.activeCampusId
        }).forUpdate().first('department_id', 'title');
        if (!vacancy) throw campusScopeError('Vacancy is outside the active campus.');
        await this.assertStaffCapacity(actor.orgId, 1, trx);
        staffId = randomUUID();
        await trx('staff').insert({
          id: staffId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          user_id: null, department_id: vacancy.department_id,
          given_name_en: applicant.given_name, father_name_en: applicant.father_name,
          grandfather_name_en: applicant.grandfather_name, given_name_am: '',
          father_name_am: '', grandfather_name_am: '', job_title: vacancy.title,
          qualification: '', employment_status: 'active', hired_on: trx.fn.now()
        });
      }
      const before = { status: applicant.status, staffId: applicant.staff_id };
      await trx('hr_applicants').where({ id: applicantId }).update({
        status: decision.decision, staff_id: staffId, updated_at: trx.fn.now()
      });
      const after = { ...before, status: decision.decision, staffId };
      await trx('audit_log').insert(auditRow(actor, `hr.applicant_${decision.decision}`,
        'hr_applicant', applicantId, before, { ...after, reason: decision.reason }));
      return {
        id: applicant.id, organizationId: applicant.organization_id,
        campusId: applicant.campus_id, vacancyId: applicant.vacancy_id,
        givenName: applicant.given_name, fatherName: applicant.father_name,
        grandfatherName: applicant.grandfather_name, email: applicant.email,
        phone: applicant.phone, status: decision.decision, staffId
      };
    });
  },
  async storeHrApplicantDocument(applicantId, category, originalName, mimeType, content, actor) {
    if (!Buffer.isBuffer(content) || !content.length || content.length > maximumDocumentSize ||
        !allowedTypes.has(mimeType)) throw hrError('INVALID_DOCUMENT',
      'Upload a non-empty PDF, JPEG, or PNG file no larger than 5 MB.');
    const applicant = await this.db('hr_applicants').where({
      id: applicantId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first('id');
    if (!applicant) return null;
    const id = randomUUID();
    const storageKey = randomUUID();
    const row = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      applicant_id: applicantId, category, original_name: safeFilename(originalName),
      mime_type: mimeType, size_bytes: content.length, storage_key: storageKey,
      sha256: createHash('sha256').update(content).digest('hex'), uploaded_by: actor.sub
    };
    const filePath = path.join(this.privateDocumentsDir, storageKey);
    await mkdir(this.privateDocumentsDir, { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    try {
      await this.db.transaction(async (trx) => {
        await this.assertStorageCapacity(actor.orgId, content.length, 0, trx);
        await trx('hr_applicant_documents').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'hr.applicant_document_uploaded',
          'hr_applicant_document', id, null, {
            applicantId, category, sizeBytes: content.length, sha256: row.sha256
          }));
      });
    } catch (error) {
      try { await unlink(filePath); }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError],
          'Applicant document metadata write and private-file cleanup both failed.');
      }
      throw error;
    }
    return {
      id, organizationId: actor.orgId, campusId: actor.activeCampusId, applicantId,
      category, originalName: row.original_name, mimeType, sizeBytes: content.length,
      sha256: row.sha256, uploadedBy: actor.sub
    };
  },
  async listHrApplicantDocuments(applicantId, actor) {
    const applicant = await this.db('hr_applicants').where({
      id: applicantId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first('id');
    if (!applicant) return null;
    const rows = await this.db('hr_applicant_documents').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, applicant_id: applicantId
    }).orderBy('created_at', 'desc').limit(100);
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      applicantId: row.applicant_id, category: row.category, originalName: row.original_name,
      mimeType: row.mime_type, sizeBytes: row.size_bytes, sha256: row.sha256,
      uploadedBy: row.uploaded_by, createdAt: row.created_at
    }));
  },
  async getHrApplicantDocument(applicantId, documentId, actor) {
    const row = await this.db('hr_applicant_documents').where({
      id: documentId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      applicant_id: applicantId
    }).first();
    if (!row) return null;
    await this.appendAudit(actor, 'hr.applicant_document_downloaded',
      'hr_applicant_document', row.id, null, { applicantId, category: row.category });
    const filePath = path.join(this.privateDocumentsDir, path.basename(row.storage_key));
    return {
      document: {
        id: row.id, applicantId: row.applicant_id, category: row.category,
        originalName: row.original_name, mimeType: row.mime_type, sizeBytes: row.size_bytes
      },
      content: await readFile(filePath)
    };
  },
  async createHrPerformanceCycle(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        const row = {
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          name: data.name, starts_on: data.startsOn, ends_on: data.endsOn,
          status: 'open', created_by: actor.sub
        };
        await trx('hr_performance_cycles').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'hr.performance_cycle_created',
          'hr_performance_cycle', id, null, row));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('A performance cycle with this name already exists.');
      throw error;
    }
    return { id, organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'open', createdBy: actor.sub };
  },
  async listHrPerformanceCycles(actor) {
    const rows = await this.db('hr_performance_cycles').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('starts_on', 'desc').limit(200);
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      name: row.name, startsOn: dateOnly(row.starts_on), endsOn: dateOnly(row.ends_on),
      status: row.status, createdBy: row.created_by
    }));
  },
  async createHrPerformanceGoal(data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      if (!await this.findHrStaff(data.staffId, actor, true, trx) ||
          !await trx('hr_performance_cycles').where({
            id: data.cycleId, organization_id: actor.orgId, campus_id: actor.activeCampusId
          }).first('id')) throw campusScopeError('Staff or performance cycle is outside the active campus.');
      const row = {
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        staff_id: data.staffId, cycle_id: data.cycleId, title: data.title,
        details: data.details, status: 'open', created_by: actor.sub
      };
      await trx('hr_performance_goals').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'hr.performance_goal_created',
        'hr_performance_goal', id, null, row));
      return { id, organizationId: actor.orgId, campusId: actor.activeCampusId,
        ...data, status: 'open', createdBy: actor.sub };
    });
  },
  async listHrPerformanceGoals(actor, staffId) {
    if (staffId && !await this.findHrStaff(staffId, actor, true)) return null;
    const query = this.db('hr_performance_goals').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    });
    if (staffId) query.where({ staff_id: staffId });
    const rows = await query.orderBy('created_at', 'desc').limit(500);
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      staffId: row.staff_id, cycleId: row.cycle_id, title: row.title,
      details: row.details, status: row.status, createdBy: row.created_by
    }));
  },
  async createHrPerformanceEvaluation(data, actor) {
    const id = randomUUID();
    try {
      return await this.db.transaction(async (trx) => {
        if (!await this.findHrStaff(data.staffId, actor, true, trx) ||
            !await trx('hr_performance_cycles').where({
              id: data.cycleId, organization_id: actor.orgId, campus_id: actor.activeCampusId
            }).first('id')) throw campusScopeError('Staff or performance cycle is outside the active campus.');
        const row = {
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          staff_id: data.staffId, cycle_id: data.cycleId, rating: data.rating,
          feedback: data.feedback, evaluated_by: actor.sub
        };
        await trx('hr_performance_evaluations').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'hr.performance_evaluated',
          'hr_performance_evaluation', id, null, row));
        return { id, organizationId: actor.orgId, campusId: actor.activeCampusId,
          ...data, evaluatedBy: actor.sub };
      });
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      const row = await this.db('hr_performance_evaluations').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        staff_id: data.staffId, cycle_id: data.cycleId
      }).first();
      return row ? {
        id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
        staffId: row.staff_id, cycleId: row.cycle_id, rating: row.rating,
        feedback: row.feedback, evaluatedBy: row.evaluated_by
      } : null;
    }
  },
  async listHrPerformanceEvaluations(actor, staffId) {
    if (staffId && !await this.findHrStaff(staffId, actor, true)) return null;
    const query = this.db('hr_performance_evaluations').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    });
    if (staffId) query.where({ staff_id: staffId });
    const rows = await query.orderBy('created_at', 'desc').limit(500);
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      staffId: row.staff_id, cycleId: row.cycle_id, rating: row.rating,
      feedback: row.feedback, evaluatedBy: row.evaluated_by, createdAt: row.created_at
    }));
  },
  async createHrTrainingCourse(data, actor) {
    const id = randomUUID();
    const row = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      title: data.title, description: data.description, starts_on: data.startsOn,
      ends_on: data.endsOn, status: 'open', created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('hr_training_courses').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'hr.training_course_created',
        'hr_training_course', id, null, row));
    });
    return { id, organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'open', createdBy: actor.sub };
  },
  async listHrTrainingCourses(actor) {
    const rows = await this.db('hr_training_courses').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('starts_on', 'desc').limit(200);
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      title: row.title, description: row.description, startsOn: dateOnly(row.starts_on),
      endsOn: dateOnly(row.ends_on), status: row.status, createdBy: row.created_by
    }));
  },
  async enrollHrTraining(courseId, staffId, actor) {
    const id = randomUUID();
    try {
      return await this.db.transaction(async (trx) => {
        const course = await trx('hr_training_courses').where({
          id: courseId, organization_id: actor.orgId,
          campus_id: actor.activeCampusId, status: 'open'
        }).forUpdate().first('id');
        if (!course || !await this.findHrStaff(staffId, actor, true, trx)) return null;
        const row = {
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          course_id: courseId, staff_id: staffId, status: 'enrolled'
        };
        await trx('hr_training_enrollments').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'hr.training_enrolled',
          'hr_training_enrollment', id, null, row));
        await this.addHrNotifications(trx, actor, 'hr_training_enrolled', id,
          'Training enrollment', `A staff member enrolled in course ${courseId}.`);
        return { id, organizationId: actor.orgId, campusId: actor.activeCampusId,
          courseId, staffId, status: 'enrolled' };
      });
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      const row = await this.db('hr_training_enrollments').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        course_id: courseId, staff_id: staffId
      }).first();
      return row ? {
        id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
        courseId: row.course_id, staffId: row.staff_id, status: row.status,
        certificateName: row.certificate_name
      } : null;
    }
  },
  async listHrTrainingEnrollments(courseId, actor) {
    const course = await this.db('hr_training_courses').where({
      id: courseId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first('id');
    if (!course) return null;
    const rows = await this.db('hr_training_enrollments').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, course_id: courseId
    }).orderBy('created_at').limit(500);
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      courseId: row.course_id, staffId: row.staff_id, status: row.status,
      certificateName: row.certificate_name
    }));
  },
  async updateHrTrainingAttendance(enrollmentId, status, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('hr_training_enrollments').where({
        id: enrollmentId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      const before = { status: row.status };
      await trx('hr_training_enrollments').where({ id: enrollmentId }).update({
        status, updated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(actor, 'hr.training_attendance_updated',
        'hr_training_enrollment', enrollmentId, before, { status }));
      return {
        id: enrollmentId, organizationId: actor.orgId, campusId: actor.activeCampusId,
        courseId: row.course_id, staffId: row.staff_id, status,
        certificateName: row.certificate_name
      };
    });
  },
  async storeHrTrainingCertificate(enrollmentId, originalName, mimeType, content, actor) {
    if (!Buffer.isBuffer(content) || !content.length || content.length > maximumDocumentSize ||
        !allowedTypes.has(mimeType)) throw hrError('INVALID_DOCUMENT',
      'Upload a non-empty PDF, JPEG, or PNG file no larger than 5 MB.');
    const storageKey = randomUUID();
    const filePath = path.join(this.privateDocumentsDir, storageKey);
    await mkdir(this.privateDocumentsDir, { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    try {
      return await this.db.transaction(async (trx) => {
        const row = await trx('hr_training_enrollments').where({
          id: enrollmentId, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).forUpdate().first();
        if (!row) {
          await unlink(filePath);
          return null;
        }
        await this.assertStorageCapacity(actor.orgId, content.length, 0, trx);
        const name = safeFilename(originalName);
        const sha256 = createHash('sha256').update(content).digest('hex');
        await trx('hr_training_enrollments').where({ id: enrollmentId }).update({
          certificate_name: name, certificate_mime_type: mimeType,
          certificate_size_bytes: content.length, certificate_storage_key: storageKey,
          certificate_sha256: sha256, updated_at: trx.fn.now()
        });
        await trx('audit_log').insert(auditRow(actor, 'hr.training_certificate_uploaded',
          'hr_training_enrollment', enrollmentId,
          { certificateName: row.certificate_name }, {
            certificateName: name, sizeBytes: content.length, sha256
          }));
        return {
          id: enrollmentId, organizationId: actor.orgId, campusId: actor.activeCampusId,
          courseId: row.course_id, staffId: row.staff_id, status: row.status,
          certificateName: name, certificateMimeType: mimeType,
          certificateSizeBytes: content.length, certificateSha256: sha256
        };
      });
    } catch (error) {
      try { await unlink(filePath); }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError],
          'Certificate metadata write and private-file cleanup both failed.');
      }
      throw error;
    }
  },
  async getHrTrainingCertificate(enrollmentId, actor) {
    const row = await this.db('hr_training_enrollments').where({
      id: enrollmentId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNotNull('certificate_storage_key').first();
    if (!row) return null;
    await this.appendAudit(actor, 'hr.training_certificate_downloaded',
      'hr_training_enrollment', row.id, null, {
        certificateName: row.certificate_name
      });
    const filePath = path.join(this.privateDocumentsDir,
      path.basename(row.certificate_storage_key));
    return {
      name: row.certificate_name, mimeType: row.certificate_mime_type,
      content: await readFile(filePath)
    };
  }
};
