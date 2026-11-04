import { randomUUID } from 'node:crypto';
import { auditRow } from '../shared.js';
import { addDays, addisDate } from '../../utils/dates.js';

function libraryError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function duplicate(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

function dateOnly(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

function minor(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new TypeError('Stored library fine exceeds safe integer precision.');
  return amount;
}

function mapCategory(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    name: row.name, status: row.status, archivedAt: row.archived_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapBook(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    categoryId: row.category_id, title: row.title, author: row.author, isbn: row.isbn,
    publisher: row.publisher, description: row.description, status: row.status,
    archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapCopy(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    bookId: row.book_id, copyNumber: row.copy_number, barcode: row.barcode,
    condition: row.condition, shelfLocation: row.shelf_location, status: row.status,
    archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapMember(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    memberType: row.member_type, studentId: row.student_id, staffId: row.staff_id,
    status: row.status, archivedAt: row.archived_at,
    name: row.member_name ?? '', studentNo: row.student_no ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapLoan(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    bookId: row.book_id, copyId: row.copy_id, memberId: row.member_id,
    issuedOn: dateOnly(row.issued_on), dueOn: dateOnly(row.due_on),
    returnedOn: row.returned_on ? dateOnly(row.returned_on) : null,
    status: row.status, renewalCount: row.renewal_count,
    returnCondition: row.return_condition, issuedBy: row.issued_by,
    returnedBy: row.returned_by, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapReservation(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    bookId: row.book_id, memberId: row.member_id, queuePosition: row.queue_position,
    status: row.status, readyCopyId: row.ready_copy_id,
    readyUntil: row.ready_until ? dateOnly(row.ready_until) : null,
    readyAt: row.ready_at, fulfilledAt: row.fulfilled_at, cancelledAt: row.cancelled_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapFine(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    loanId: row.loan_id, memberId: row.member_id, amountMinor: minor(row.amount_minor),
    currencyCode: row.currency_code, overdueDays: row.overdue_days, status: row.status,
    reason: row.reason, waivedBy: row.waived_by, paidBy: row.paid_by,
    paidOn: row.paid_on ? dateOnly(row.paid_on) : null, waivedAt: row.waived_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

async function audit(trx, actor, action, entity, id, before, after) {
  await trx('audit_log').insert(auditRow(actor, `library.${action}`, entity, id, before, after));
}
async function settings(trx, actor, lock = false) {
  const query = trx('library_settings').where({
    organization_id: actor.orgId, campus_id: actor.activeCampusId
  });
  if (lock) query.forUpdate();
  const row = await query.first();
  if (row) return row;
  const org = await trx('organizations').where({ id: actor.orgId }).first('currency_code');
  return {
    loan_period_days: 14, max_active_loans: 5, max_renewals: 2,
    fine_minor_per_day: 100, currency_code: org?.currency_code ?? 'ETB'
  };
}
async function notifyMember(trx, actor, member, sourceType, sourceId, title, body) {
  const personTable = member.member_type === 'student' ? 'students' : 'staff';
  const personId = member.member_type === 'student' ? member.student_id : member.staff_id;
  const personQuery = trx(personTable).where({
    [`${personTable}.id`]: personId, [`${personTable}.campus_id`]: actor.activeCampusId
  });
  if (member.member_type === 'student') {
    personQuery.join('campuses as c', 'c.id', 'students.campus_id')
      .where('c.organization_id', actor.orgId);
  } else {
    personQuery.where(`${personTable}.organization_id`, actor.orgId);
  }
  const person = await personQuery.first(`${personTable}.user_id`);
  if (!person?.user_id) return;
  await trx('user_notifications').insert({
    id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
    user_id: person.user_id, source_type: sourceType, source_id: sourceId,
    title_en: title, title_am: title, body_en: body, body_am: body
  }).onConflict(['user_id', 'source_type', 'source_id']).ignore();
}

async function loanResult(trx, loanId, actor) {
  const row = await trx('library_loans').where({
    id: loanId, organization_id: actor.orgId, campus_id: actor.activeCampusId
  }).first();
  if (!row) return null;
  const [book, copy, fine] = await Promise.all([
    trx('library_books').where({ id: row.book_id, organization_id: actor.orgId,
      campus_id: actor.activeCampusId }).first(),
    trx('library_copies').where({ id: row.copy_id, organization_id: actor.orgId,
      campus_id: actor.activeCampusId }).first(),
    trx('library_fines').where({ loan_id: row.id, organization_id: actor.orgId,
      campus_id: actor.activeCampusId }).first()
  ]);
  return { ...mapLoan(row), book: book ? mapBook(book) : null,
    copy: copy ? mapCopy(copy) : null, fine: fine ? mapFine(fine) : null };
}

export const mysqlLibraryBundle = {
  async listLibraryCategories(actor) {
    return (await this.db('library_categories').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').orderBy('name')).map(mapCategory);
  },
  async createLibraryCategory(data, actor) {
    const row = { id: randomUUID(), organization_id: actor.orgId,
      campus_id: actor.activeCampusId, ...data, status: 'active' };
    try {
      await this.db.transaction(async (trx) => {
        await trx('library_categories').insert(row);
        await audit(trx, actor, 'category_created', 'library_category', row.id, null, data);
      });
    } catch (error) {
      if (duplicate(error)) throw libraryError('LIBRARY_CATEGORY_DUPLICATE', 'A category with this name already exists.');
      throw error;
    }
    return mapCategory(await this.db('library_categories').where({
      id: row.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async updateLibraryCategory(id, data, actor) {
    const row = await this.db('library_categories').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first();
    if (!row) return null;
    await this.db.transaction(async (trx) => {
      await trx('library_categories').where({ id, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update({ ...data, updated_at: trx.fn.now() });
      await audit(trx, actor, 'category_updated', 'library_category', id, mapCategory(row), data);
    });
    return mapCategory(await this.db('library_categories').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async listLibraryBooks(query, actor) {
    const builder = this.db('library_books as b').where({
      'b.organization_id': actor.orgId, 'b.campus_id': actor.activeCampusId
    }).modify((q) => {
      if (query.status) q.where('b.status', query.status);
      else q.whereNull('b.archived_at');
      if (query.categoryId) q.where('b.category_id', query.categoryId);
      if (query.search) q.where((inner) => inner.where('b.title', 'like', `%${query.search}%`)
        .orWhere('b.author', 'like', `%${query.search}%`).orWhere('b.isbn', 'like', `%${query.search}%`)
        .orWhere('b.publisher', 'like', `%${query.search}%`));
    }).orderBy('b.title').limit(500);
    const rows = await builder.select('b.*');
    const result = [];
    for (const row of rows) {
      const copies = await this.db('library_copies').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, book_id: row.id
      }).whereNull('archived_at').orderBy('copy_number').limit(100).select('*');
      result.push({ ...mapBook(row), copies: copies.map(mapCopy) });
    }
    return result;
  },
  async createLibraryBook(data, actor) {
    const row = { id: randomUUID(), organization_id: actor.orgId,
      campus_id: actor.activeCampusId, category_id: data.categoryId ?? null,
      title: data.title, author: data.author, isbn: data.isbn || null,
      publisher: data.publisher, description: data.description, status: 'active' };
    try {
      await this.db.transaction(async (trx) => {
        if (row.category_id && !await trx('library_categories').where({
          id: row.category_id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).whereNull('archived_at').forUpdate().first()) {
          throw libraryError('LIBRARY_CATEGORY_NOT_FOUND', 'Active category not found.', 404);
        }
        await trx('library_books').insert(row);
        await audit(trx, actor, 'book_created', 'library_book', row.id, null, data);
      });
    } catch (error) {
      if (duplicate(error)) throw libraryError('LIBRARY_ISBN_DUPLICATE', 'A book with this ISBN already exists.');
      throw error;
    }
    return mapBook(await this.db('library_books').where({
      id: row.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async updateLibraryBook(id, data, actor) {
    let updated = null;
    try {
      await this.db.transaction(async (trx) => {
        const row = await trx('library_books').where({
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).whereNull('archived_at').forUpdate().first();
        if (!row) return;
        if (data.categoryId && !await trx('library_categories').where({
          id: data.categoryId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).whereNull('archived_at').first()) {
          throw libraryError('LIBRARY_CATEGORY_NOT_FOUND', 'Active category not found.', 404);
        }
        const values = { ...data, updated_at: trx.fn.now() };
        if (data.categoryId !== undefined) values.category_id = data.categoryId;
        delete values.categoryId;
        await trx('library_books').where({ id, organization_id: actor.orgId,
          campus_id: actor.activeCampusId }).update(values);
        updated = { before: mapBook(row), after: data };
        await audit(trx, actor, 'book_updated', 'library_book', id, updated.before, data);
      });
    } catch (error) {
      if (duplicate(error)) throw libraryError('LIBRARY_ISBN_DUPLICATE', 'A book with this ISBN already exists.');
      throw error;
    }
    if (!updated) return null;
    const saved = await this.db('library_books').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first();
    return saved ? mapBook(saved) : null;
  },
  async archiveLibraryBook(id, actor) {
    const row = await this.db('library_books').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first();
    if (!row) return null;
    await this.db.transaction(async (trx) => {
      await trx('library_books').where({ id, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update({
        status: 'archived', archived_at: trx.fn.now(), updated_at: trx.fn.now()
      });
      await audit(trx, actor, 'book_archived', 'library_book', id, mapBook(row), { status: 'archived' });
    });
    return mapBook(await this.db('library_books').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async listLibraryCopies(query, actor) {
    const builder = this.db('library_copies as cp').join('library_books as b', function joinBook() {
      this.on('b.id', '=', 'cp.book_id').andOn('b.organization_id', '=', 'cp.organization_id')
        .andOn('b.campus_id', '=', 'cp.campus_id');
    })
      .where({ 'cp.organization_id': actor.orgId, 'cp.campus_id': actor.activeCampusId })
      .modify((q) => {
        if (query.status) q.where('cp.status', query.status);
        else q.whereNull('cp.archived_at');
        if (query.barcode) q.where('cp.barcode', query.barcode);
        if (query.categoryId) q.where('b.category_id', query.categoryId);
        if (query.search) q.where((inner) => inner.where('cp.barcode', 'like', `%${query.search}%`)
          .orWhere('cp.copy_number', 'like', `%${query.search}%`)
          .orWhere('cp.shelf_location', 'like', `%${query.search}%`)
          .orWhere('b.title', 'like', `%${query.search}%`).orWhere('b.author', 'like', `%${query.search}%`));
      }).orderBy('b.title').limit(1000).select('cp.*', 'b.title as book_title',
        'b.author as book_author', 'b.isbn as book_isbn', 'b.publisher as book_publisher',
        'b.description as book_description', 'b.category_id as book_category_id',
        'b.status as book_status', 'b.archived_at as book_archived_at',
        'b.created_at as book_created_at', 'b.updated_at as book_updated_at');
    return (await builder).map((row) => ({
      ...mapCopy(row), book: {
        id: row.book_id, title: row.book_title, author: row.book_author, isbn: row.book_isbn,
        publisher: row.book_publisher, description: row.book_description,
        categoryId: row.book_category_id, status: row.book_status
      }
    }));
  },
  async findLibraryCopyByBarcode(barcode, actor) {
    return (await this.listLibraryCopies({ barcode }, actor))[0] ?? null;
  },
  async createLibraryCopy(data, actor) {
    const row = { id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
      book_id: data.bookId, copy_number: data.copyNumber, barcode: data.barcode,
      condition: data.condition, shelf_location: data.shelfLocation, status: 'available' };
    try {
      await this.db.transaction(async (trx) => {
        if (!await trx('library_books').where({
          id: data.bookId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).whereNull('archived_at').forUpdate().first()) {
          throw libraryError('LIBRARY_BOOK_NOT_FOUND', 'Active book not found.', 404);
        }
        await trx('library_copies').insert(row);
        await audit(trx, actor, 'copy_created', 'library_copy', row.id, null, data);
      });
    } catch (error) {
      if (duplicate(error)) throw libraryError('LIBRARY_COPY_DUPLICATE', 'Barcode or copy number already exists.');
      throw error;
    }
    return mapCopy(await this.db('library_copies').where({
      id: row.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async updateLibraryCopy(id, data, actor) {
    let updated = false;
    try {
      await this.db.transaction(async (trx) => {
        const row = await trx('library_copies').where({
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).whereNull('archived_at').forUpdate().first();
        if (!row) return;
        if (data.condition && ['damaged', 'lost'].includes(data.condition) && row.status === 'loaned') {
          throw libraryError('LIBRARY_COPY_ON_LOAN', 'Return the copy before changing it to damaged or lost.');
        }
        const status = data.condition && ['damaged', 'lost'].includes(data.condition)
          ? data.condition
          : data.condition && ['damaged', 'lost'].includes(row.condition) ? 'available' : row.status;
        const values = { ...data, status, updated_at: trx.fn.now() };
        if (data.copyNumber !== undefined) values.copy_number = data.copyNumber;
        if (data.shelfLocation !== undefined) values.shelf_location = data.shelfLocation;
        delete values.copyNumber;
        delete values.shelfLocation;
        await trx('library_copies').where({ id, organization_id: actor.orgId,
          campus_id: actor.activeCampusId }).update(values);
        await audit(trx, actor, 'copy_updated', 'library_copy', id, mapCopy(row), data);
        if (data.condition && data.condition !== row.condition) {
          await audit(trx, actor, 'condition_changed', 'library_copy', id,
            { condition: row.condition }, { condition: data.condition });
        }
        updated = true;
      });
    } catch (error) {
      if (duplicate(error)) throw libraryError('LIBRARY_COPY_DUPLICATE', 'Barcode already exists.');
      throw error;
    }
    if (!updated) return null;
    return mapCopy(await this.db('library_copies').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async archiveLibraryCopy(id, actor) {
    await this.db.transaction(async (trx) => {
      const row = await trx('library_copies').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return;
      if (['loaned', 'reserved'].includes(row.status)) {
        throw libraryError('LIBRARY_COPY_ON_LOAN', 'A loaned or reserved copy cannot be archived.');
      }
      await trx('library_copies').where({ id, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update({
        status: 'archived', archived_at: trx.fn.now(), updated_at: trx.fn.now()
      });
      await audit(trx, actor, 'copy_archived', 'library_copy', id, mapCopy(row), { status: 'archived' });
    });
    const archived = await this.db('library_copies').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first();
    return archived ? mapCopy(archived) : null;
  },
  async listLibraryMembers(actor) {
    const rows = await this.db('library_members as lm')
      .leftJoin('students as s', function joinStudent() {
        this.on('s.id', '=', 'lm.student_id').andOn('s.campus_id', '=', 'lm.campus_id');
      }).leftJoin('staff as st', function joinStaff() {
        this.on('st.id', '=', 'lm.staff_id').andOn('st.organization_id', '=', 'lm.organization_id')
          .andOn('st.campus_id', '=', 'lm.campus_id');
      })
      .where({ 'lm.organization_id': actor.orgId, 'lm.campus_id': actor.activeCampusId })
      .whereNull('lm.archived_at')
      .select('lm.*', this.db.raw("COALESCE(TRIM(CONCAT(s.given_name_en, ' ', s.father_name_en, ' ', s.grandfather_name_en)), TRIM(CONCAT(st.given_name_en, ' ', st.father_name_en, ' ', st.grandfather_name_en))) as member_name"),
        's.student_no');
    return rows.map(mapMember);
  },
  async addLibraryMember(data, actor) {
    const row = { id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
      member_type: data.memberType, student_id: data.studentId ?? null,
      staff_id: data.staffId ?? null, status: 'active' };
    try {
      await this.db.transaction(async (trx) => {
        const table = data.memberType === 'student' ? 'students' : 'staff';
        const personQuery = trx(table).where({
          [`${table}.id`]: data.memberType === 'student' ? data.studentId : data.staffId,
          [`${table}.campus_id`]: actor.activeCampusId,
          ...(data.memberType === 'student' ? { [`${table}.status`]: 'enrolled' } :
            { [`${table}.organization_id`]: actor.orgId,
              [`${table}.employment_status`]: 'active' })
        }).whereNull(`${table}.archived_at`);
        if (data.memberType === 'student') {
          personQuery.join('campuses as c', 'c.id', 'students.campus_id')
            .where('c.organization_id', actor.orgId);
        }
        const person = await personQuery.forUpdate().first(`${table}.id`);
        if (!person) throw libraryError('LIBRARY_MEMBER_INACTIVE', 'Select an active student or staff member.');
        const existing = await trx('library_members').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          ...(data.memberType === 'student' ? { student_id: data.studentId } : { staff_id: data.staffId })
        }).first();
        if (existing) { row.id = existing.id; return; }
        await trx('library_members').insert(row);
        await audit(trx, actor, 'member_created', 'library_member', row.id, null, data);
      });
    } catch (error) {
      if (duplicate(error)) {
        const existing = await this.db('library_members').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          ...(data.memberType === 'student' ? { student_id: data.studentId } : { staff_id: data.staffId })
        }).first();
        if (existing) row.id = existing.id;
        else throw error;
      } else throw error;
    }
    const result = (await this.listLibraryMembers(actor)).find((item) => item.id === row.id);
    return result;
  },
  async getLibrarySettings(actor) {
    const row = await this.db('library_settings').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first();
    if (!row) {
      const org = await this.db('organizations').where({ id: actor.orgId }).first('currency_code');
      return { loanPeriodDays: 14, maxActiveLoans: 5, maxRenewals: 2,
        fineMinorPerDay: 100, currencyCode: org?.currency_code ?? 'ETB' };
    }
    return { loanPeriodDays: row.loan_period_days, maxActiveLoans: row.max_active_loans,
      maxRenewals: row.max_renewals, fineMinorPerDay: minor(row.fine_minor_per_day),
      currencyCode: row.currency_code };
  },
  async updateLibrarySettings(data, actor) {
    await this.db.transaction(async (trx) => {
      const current = await trx('library_settings').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      const values = {
        loan_period_days: data.loanPeriodDays, max_active_loans: data.maxActiveLoans,
        max_renewals: data.maxRenewals, fine_minor_per_day: data.fineMinorPerDay,
        currency_code: data.currencyCode, updated_at: trx.fn.now()
      };
      if (current) {
        await trx('library_settings').where({ id: current.id,
          organization_id: actor.orgId, campus_id: actor.activeCampusId }).update(values);
        await audit(trx, actor, 'settings_updated', 'library_settings', current.id, current, data);
      } else {
        const id = randomUUID();
        await trx('library_settings').insert({ id, organization_id: actor.orgId,
          campus_id: actor.activeCampusId, ...values });
        await audit(trx, actor, 'settings_created', 'library_settings', id, null, data);
      }
    });
    return this.getLibrarySettings(actor);
  },
  async getLibraryDashboard(actor) {
    const [total, available, borrowed, overdue] = await Promise.all([
      this.db('library_copies').where({ organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).whereNull('archived_at').count({ count: '*' }).first(),
      this.db('library_copies').where({ organization_id: actor.orgId,
        campus_id: actor.activeCampusId, status: 'available' }).whereNull('archived_at')
        .count({ count: '*' }).first(),
      this.db('library_loans').where({ organization_id: actor.orgId,
        campus_id: actor.activeCampusId, status: 'active' }).count({ count: '*' }).first(),
      this.db('library_loans').where({ organization_id: actor.orgId,
        campus_id: actor.activeCampusId, status: 'active' }).where('due_on', '<', addisDate())
        .count({ count: '*' }).first()
    ]);
    return { total: Number(total.count), available: Number(available.count),
      borrowed: Number(borrowed.count), overdue: Number(overdue.count) };
  },
  async listLibraryLoans(status, actor) {
    const today = addisDate();
    const due = await this.db('library_loans as l')
      .join('library_members as m', function joinMember() {
        this.on('m.id', '=', 'l.member_id').andOn('m.organization_id', '=', 'l.organization_id')
          .andOn('m.campus_id', '=', 'l.campus_id');
      })
      .where({ 'l.organization_id': actor.orgId, 'l.campus_id': actor.activeCampusId,
        'l.status': 'active' }).where('l.due_on', '<=', addDays(today, 3))
      .select('l.id', 'l.due_on', 'm.*').limit(1000);
    for (const row of due) {
      const overdue = dateOnly(row.due_on) < today;
      await this.db.transaction(async (trx) => notifyMember(trx, actor, row,
        overdue ? 'library_overdue' : 'library_due_soon', row.id,
        overdue ? 'Library book overdue' : 'Library book due soon',
        `A borrowed book is due on ${dateOnly(row.due_on)}.`));
    }
    const query = this.db('library_loans as l')
      .join('library_books as b', function joinBook() {
        this.on('b.id', '=', 'l.book_id').andOn('b.organization_id', '=', 'l.organization_id')
          .andOn('b.campus_id', '=', 'l.campus_id');
      }).join('library_copies as cp', function joinCopy() {
        this.on('cp.id', '=', 'l.copy_id').andOn('cp.organization_id', '=', 'l.organization_id')
          .andOn('cp.campus_id', '=', 'l.campus_id');
      }).join('library_members as m', function joinMember() {
        this.on('m.id', '=', 'l.member_id').andOn('m.organization_id', '=', 'l.organization_id')
          .andOn('m.campus_id', '=', 'l.campus_id');
      }).leftJoin('students as s', function joinStudent() {
        this.on('s.id', '=', 'm.student_id').andOn('s.campus_id', '=', 'm.campus_id');
      }).leftJoin('staff as st', function joinStaff() {
        this.on('st.id', '=', 'm.staff_id').andOn('st.organization_id', '=', 'm.organization_id')
          .andOn('st.campus_id', '=', 'm.campus_id');
      }).leftJoin('library_fines as f', function joinFine() {
        this.on('f.loan_id', '=', 'l.id').andOn('f.organization_id', '=', 'l.organization_id')
          .andOn('f.campus_id', '=', 'l.campus_id');
      })
      .where({ 'l.organization_id': actor.orgId, 'l.campus_id': actor.activeCampusId })
      .modify((builder) => { if (status) builder.where('l.status', status); })
      .orderBy('l.issued_on', 'desc').limit(1000)
      .select('l.*', 'b.title as book_title', 'b.author as book_author', 'b.isbn as book_isbn',
        'cp.copy_number', 'cp.barcode', 'cp.condition as copy_condition',
        'cp.shelf_location', 'cp.status as copy_status', 'm.member_type', 'm.student_id',
        'm.staff_id', 'm.status as member_status', 'm.archived_at as member_archived_at',
        'm.created_at as member_created_at', 'm.updated_at as member_updated_at',
        this.db.raw("COALESCE(TRIM(CONCAT(s.given_name_en, ' ', s.father_name_en, ' ', s.grandfather_name_en)), TRIM(CONCAT(st.given_name_en, ' ', st.father_name_en, ' ', st.grandfather_name_en))) as member_name"),
        's.student_no', 'f.id as fine_id', 'f.amount_minor as fine_amount_minor',
        'f.currency_code as fine_currency_code', 'f.overdue_days as fine_overdue_days',
        'f.status as fine_status', 'f.reason as fine_reason', 'f.paid_on as fine_paid_on',
        'f.waived_at as fine_waived_at');
    return (await query).map((row) => ({
      ...mapLoan(row),
      book: { id: row.book_id, title: row.book_title, author: row.book_author, isbn: row.book_isbn },
      copy: { id: row.copy_id, copyNumber: row.copy_number, barcode: row.barcode,
        condition: row.copy_condition, shelfLocation: row.shelf_location, status: row.copy_status },
      member: { id: row.member_id, memberType: row.member_type, studentId: row.student_id,
        staffId: row.staff_id, name: row.member_name, studentNo: row.student_no },
      fine: row.fine_id ? { id: row.fine_id, amountMinor: minor(row.fine_amount_minor),
        currencyCode: row.fine_currency_code, overdueDays: row.fine_overdue_days,
        status: row.fine_status, reason: row.fine_reason,
        paidOn: row.fine_paid_on ? dateOnly(row.fine_paid_on) : null, waivedAt: row.fine_waived_at } : null
    }));
  },
  async issueLibraryCopy(data, actor) {
    try {
      return await this.db.transaction(async (trx) => {
        const repeated = await trx('library_loans').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).first();
        if (repeated) return loanResult(trx, repeated.id, actor);
        const copy = await trx('library_copies').where({
          id: data.copyId, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).forUpdate().first();
        if (!copy || copy.archived_at || !['available', 'reserved'].includes(copy.status)) {
          throw libraryError('LIBRARY_COPY_UNAVAILABLE', 'Copy is unavailable for issue.');
        }
        const book = await trx('library_books').where({
          id: copy.book_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).forUpdate().first();
        if (!book || book.status !== 'active' || book.archived_at ||
            ['lost', 'damaged'].includes(copy.condition)) {
          throw libraryError('LIBRARY_COPY_UNAVAILABLE', 'Archived, lost, or damaged copies cannot be issued.');
        }
        const member = await trx('library_members').where({
          id: data.memberId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).whereNull('archived_at').forUpdate().first();
        if (!member) throw libraryError('LIBRARY_MEMBER_INACTIVE', 'Active library member not found.', 404);
        let holding = await trx('library_reservations').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId, book_id: book.id,
          status: 'ready', ready_copy_id: copy.id
        }).forUpdate().first();
        if (copy.status === 'reserved' && holding?.ready_until &&
            dateOnly(holding.ready_until) < addisDate()) {
          await trx('library_reservations').where({ id: holding.id,
            organization_id: actor.orgId, campus_id: actor.activeCampusId }).update({
            status: 'expired', updated_at: trx.fn.now()
          });
          await audit(trx, actor, 'reservation_expired', 'library_reservation', holding.id,
            mapReservation(holding), { ...mapReservation(holding), status: 'expired' });
          await trx('library_copies').where({ id: copy.id,
            organization_id: actor.orgId, campus_id: actor.activeCampusId }).update({
            status: 'available', updated_at: trx.fn.now()
          });
          copy.status = 'available';
          const next = await this.fulfillLibraryReservation(trx, book, copy, actor);
          if (next) copy.status = 'reserved';
          holding = next ?? null;
        }
        const ready = holding?.member_id === member.id ? holding : null;
        if (copy.status === 'reserved' && !ready) {
          throw libraryError('LIBRARY_COPY_RESERVED', 'This copy is reserved for another member.');
        }
        const config = await settings(trx, actor);
        const active = await trx('library_loans').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          member_id: member.id, status: 'active'
        }).forUpdate().select('due_on');
        if (active.length >= config.max_active_loans) {
          throw libraryError('LIBRARY_LOAN_LIMIT', 'Member has reached the active loan limit.');
        }
        if (active.some((loan) => dateOnly(loan.due_on) < addisDate())) {
          throw libraryError('LIBRARY_OVERDUE_BLOCK', 'Member has an overdue loan.');
        }
        const id = randomUUID();
        const loan = {
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          book_id: book.id, copy_id: copy.id, active_copy_id: copy.id, member_id: member.id,
          issued_on: data.issuedOn, due_on: addDays(data.issuedOn, config.loan_period_days),
          status: 'active', renewal_count: 0, idempotency_key: data.idempotencyKey,
          issued_by: actor.sub
        };
        await trx('library_loans').insert(loan);
        await trx('library_copies').where({ id: copy.id,
          organization_id: actor.orgId, campus_id: actor.activeCampusId }).update({
          status: 'loaned', updated_at: trx.fn.now()
        });
        if (ready) {
          await trx('library_reservations').where({ id: ready.id,
            organization_id: actor.orgId, campus_id: actor.activeCampusId }).update({
            status: 'fulfilled', fulfilled_at: trx.fn.now(), updated_at: trx.fn.now()
          });
        }
        await audit(trx, actor, 'issued', 'library_loan', id, null, loan);
        return loanResult(trx, id, actor);
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
      const repeated = await this.db('library_loans').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (repeated) return loanResult(this.db, repeated.id, actor);
      throw libraryError('LIBRARY_COPY_UNAVAILABLE', 'Copy was issued by another request.');
    }
  },
  async returnLibraryLoan(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const loan = await trx('library_loans').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!loan) return null;
      if (loan.status === 'returned') return loanResult(trx, id, actor);
      if (loan.status !== 'active') throw libraryError('LIBRARY_LOAN_INVALID_STATE', 'Loan cannot be returned.');
      const book = await trx('library_books').where({
        id: loan.book_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      const copy = await trx('library_copies').where({
        id: loan.copy_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!copy) throw libraryError('LIBRARY_COPY_NOT_FOUND', 'Copy not found.', 404);
      const config = await settings(trx, actor);
      const overdueDays = Math.max(0, Math.floor((Date.parse(`${data.returnedOn}T00:00:00Z`) -
        Date.parse(`${dateOnly(loan.due_on)}T00:00:00Z`)) / 86400000));
      let fineId = null;
      if (overdueDays > 0 && minor(config.fine_minor_per_day) > 0) {
        const amountMinor = overdueDays * minor(config.fine_minor_per_day);
        if (!Number.isSafeInteger(amountMinor)) {
          throw libraryError('LIBRARY_FINE_AMOUNT_INVALID',
            'Calculated fine exceeds safe minor-unit precision.', 422);
        }
        fineId = randomUUID();
        const fine = { id: fineId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          loan_id: loan.id, member_id: loan.member_id,
          amount_minor: amountMinor,
          currency_code: config.currency_code, overdue_days: overdueDays, status: 'unpaid' };
        await trx('library_fines').insert(fine);
        await audit(trx, actor, 'fine_created', 'library_fine', fineId, null, fine);
      }
      const before = mapLoan(loan);
      await trx('library_loans').where({ id, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update({
        status: 'returned', active_copy_id: null, returned_on: data.returnedOn,
        return_condition: data.returnCondition, returned_by: actor.sub, updated_at: trx.fn.now()
      });
      const usable = !['lost', 'damaged'].includes(data.returnCondition);
      await trx('library_copies').where({ id: copy.id,
        organization_id: actor.orgId, campus_id: actor.activeCampusId }).update({
        condition: data.returnCondition, status: usable ? 'available' : data.returnCondition,
        updated_at: trx.fn.now()
      });
      await audit(trx, actor, 'returned', 'library_loan', id, before,
        { status: 'returned', returnedOn: data.returnedOn, returnCondition: data.returnCondition });
      if (data.returnCondition !== copy.condition) await audit(trx, actor,
        'condition_changed', 'library_copy', copy.id, { condition: copy.condition },
        { condition: data.returnCondition });
      if (usable) await this.fulfillLibraryReservation(trx, book, copy, actor);
      return loanResult(trx, id, actor);
    });
  },
  async fulfillLibraryReservation(trx, book, copy, actor) {
    const next = await trx('library_reservations').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId,
      book_id: book.id, status: 'queued'
    }).orderBy('queue_position').orderBy('created_at').forUpdate().first();
    if (!next) return;
    const readyUntil = addDays(addisDate(), 3);
    await trx('library_reservations').where({ id: next.id,
      organization_id: actor.orgId, campus_id: actor.activeCampusId }).update({
      status: 'ready', ready_copy_id: copy.id, ready_until: readyUntil,
      ready_at: trx.fn.now(), updated_at: trx.fn.now()
    });
    await trx('library_copies').where({ id: copy.id,
      organization_id: actor.orgId, campus_id: actor.activeCampusId }).update({
      status: 'reserved', updated_at: trx.fn.now()
    });
    await audit(trx, actor, 'reservation_fulfilled', 'library_reservation', next.id,
      { status: 'queued' }, { status: 'ready', copyId: copy.id });
    const member = await trx('library_members').where({
      id: next.member_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first();
    if (!member) throw libraryError('LIBRARY_MEMBER_NOT_FOUND', 'Reservation member not found.', 404);
    await notifyMember(trx, actor, member, 'library_reservation_ready', next.id,
      'Library reservation ready', `A reserved copy is ready until ${readyUntil}.`);
    return next;
  },
  async renewLibraryLoan(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('library_loans').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      if (row.status !== 'active') throw libraryError('LIBRARY_LOAN_INVALID_STATE', 'Only an active loan can be renewed.');
      const config = await settings(trx, actor);
      if (row.renewal_count >= config.max_renewals) {
        throw libraryError('LIBRARY_RENEWAL_LIMIT', 'Renewal limit has been reached.');
      }
      const queued = await trx('library_reservations').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        book_id: row.book_id, status: 'queued'
      }).forUpdate().first('id');
      if (queued) throw libraryError('LIBRARY_RESERVATION_QUEUE', 'A queued reservation prevents renewal.');
      const dueOn = data.dueOn ?? addDays(dateOnly(row.due_on), config.loan_period_days);
      await trx('library_loans').where({ id, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update({
        due_on: dueOn, renewal_count: row.renewal_count + 1, updated_at: trx.fn.now()
      });
      await audit(trx, actor, 'renewed', 'library_loan', id, mapLoan(row),
        { dueOn, renewalCount: row.renewal_count + 1 });
      return loanResult(trx, id, actor);
    });
  },
  async listLibraryReservations(actor) {
    const rows = await this.db('library_reservations').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('book_id').orderBy('queue_position').limit(1000);
    return rows.map(mapReservation);
  },
  async reserveLibraryBook(data, actor) {
    try {
      return await this.db.transaction(async (trx) => {
        const repeated = await trx('library_reservations').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).first();
        if (repeated) return mapReservation(repeated);
        const book = await trx('library_books').where({
          id: data.bookId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).whereNull('archived_at').forUpdate().first();
        const member = await trx('library_members').where({
          id: data.memberId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).whereNull('archived_at').forUpdate().first();
        if (!book) throw libraryError('LIBRARY_BOOK_NOT_FOUND', 'Active book not found.', 404);
        if (!member) throw libraryError('LIBRARY_MEMBER_INACTIVE', 'Active library member not found.', 404);
        const copies = await trx('library_copies').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId, book_id: book.id
        }).whereNull('archived_at').whereNotIn('condition', ['lost', 'damaged'])
          .forUpdate().select('status');
        if (copies.some((copy) => copy.status === 'available')) {
          throw libraryError('LIBRARY_COPY_AVAILABLE', 'A copy is available; issue it instead of reserving.');
        }
        const activeReservation = await trx('library_reservations').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          book_id: book.id, member_id: member.id
        }).whereIn('status', ['queued', 'ready']).forUpdate().first();
        if (activeReservation) throw libraryError('LIBRARY_RESERVATION_EXISTS', 'Member already has an active reservation.');
        const last = await trx('library_reservations').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          book_id: book.id, status: 'queued'
        }).max({ position: 'queue_position' }).first();
        const row = { id: randomUUID(), organization_id: actor.orgId,
          campus_id: actor.activeCampusId, book_id: book.id, member_id: member.id,
          idempotency_key: data.idempotencyKey, queue_position: Number(last.position ?? 0) + 1,
          status: 'queued' };
        await trx('library_reservations').insert(row);
        await audit(trx, actor, 'reservation_created', 'library_reservation', row.id, null, row);
        return mapReservation(await trx('library_reservations').where({
          id: row.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).first());
      });
    } catch (error) {
      if (!duplicate(error)) throw error;
      const repeated = await this.db('library_reservations').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (repeated) return mapReservation(repeated);
      throw libraryError('LIBRARY_RESERVATION_EXISTS', 'Conflicting active reservation.');
    }
  },
  async cancelLibraryReservation(id, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('library_reservations').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      if (!['queued', 'ready'].includes(row.status)) {
        throw libraryError('LIBRARY_RESERVATION_INVALID_STATE', 'Reservation cannot be cancelled.');
      }
      if (row.status === 'ready' && row.ready_copy_id) {
        const book = await trx('library_books').where({
          id: row.book_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).forUpdate().first();
        const copy = await trx('library_copies').where({
          id: row.ready_copy_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).forUpdate().first();
        await trx('library_copies').where({ id: copy.id,
          organization_id: actor.orgId, campus_id: actor.activeCampusId }).update({
          status: 'available', updated_at: trx.fn.now()
        });
        await this.fulfillLibraryReservation(trx, book, copy, actor);
      }
      await trx('library_reservations').where({ id, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update({
        status: 'cancelled', cancelled_at: trx.fn.now(), updated_at: trx.fn.now()
      });
      await audit(trx, actor, 'reservation_cancelled', 'library_reservation', id,
        mapReservation(row), { status: 'cancelled' });
      return mapReservation(await trx('library_reservations').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first());
    });
  },
  async listLibraryFines(actor) {
    const rows = await this.db('library_fines as f').join('library_members as m', function joinMember() {
      this.on('m.id', '=', 'f.member_id').andOn('m.organization_id', '=', 'f.organization_id')
        .andOn('m.campus_id', '=', 'f.campus_id');
    }).leftJoin('students as s', function joinStudent() {
      this.on('s.id', '=', 'm.student_id').andOn('s.campus_id', '=', 'm.campus_id');
    }).leftJoin('staff as st', function joinStaff() {
      this.on('st.id', '=', 'm.staff_id').andOn('st.organization_id', '=', 'm.organization_id')
        .andOn('st.campus_id', '=', 'm.campus_id');
    })
      .where({ 'f.organization_id': actor.orgId, 'f.campus_id': actor.activeCampusId })
      .orderBy('f.created_at', 'desc').limit(1000).select('f.*', 'm.member_type',
        'm.student_id', 'm.staff_id', this.db.raw(
          "COALESCE(TRIM(CONCAT(s.given_name_en, ' ', s.father_name_en, ' ', s.grandfather_name_en)), TRIM(CONCAT(st.given_name_en, ' ', st.father_name_en, ' ', st.grandfather_name_en))) as member_name"));
    return rows.map((row) => ({ ...mapFine(row), member: {
      id: row.member_id, memberType: row.member_type, studentId: row.student_id,
      staffId: row.staff_id, name: row.member_name
    } }));
  },
  async updateLibraryFine(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('library_fines').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      if (row.status !== 'unpaid') throw libraryError('LIBRARY_FINE_INVALID_STATE', 'Fine is not unpaid.');
      await trx('library_fines').where({ id, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update({
        status: 'paid', paid_on: data.paidOn, paid_by: actor.sub, updated_at: trx.fn.now()
      });
      await audit(trx, actor, 'fine_paid', 'library_fine', id, mapFine(row), data);
      return mapFine(await trx('library_fines').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first());
    });
  },
  async waiveLibraryFine(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('library_fines').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      if (row.status !== 'unpaid') throw libraryError('LIBRARY_FINE_INVALID_STATE', 'Fine is not unpaid.');
      await trx('library_fines').where({ id, organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).update({
        status: 'waived', reason: data.reason, waived_by: actor.sub,
        waived_at: trx.fn.now(), updated_at: trx.fn.now()
      });
      await audit(trx, actor, 'fine_waived', 'library_fine', id, mapFine(row),
        { status: 'waived', reason: data.reason });
      return mapFine(await trx('library_fines').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first());
    });
  },
  async getPortalLibrary(actor) {
    let membersQuery = this.db('library_members as m')
      .where({ 'm.organization_id': actor.orgId, 'm.campus_id': actor.activeCampusId,
        'm.status': 'active' }).whereNull('m.archived_at');
    if (actor.role === 'student') {
      membersQuery = membersQuery.join('students as s', 's.id', 'm.student_id')
        .join('campuses as c', 'c.id', 's.campus_id')
        .where({ 's.user_id': actor.sub, 's.campus_id': actor.activeCampusId,
          'c.organization_id': actor.orgId });
    } else if (['homeroom_teacher', 'subject_teacher'].includes(actor.role)) {
      membersQuery = membersQuery.join('staff as st', 'st.id', 'm.staff_id')
        .where({ 'st.user_id': actor.sub, 'st.organization_id': actor.orgId,
          'st.campus_id': actor.activeCampusId });
    } else if (actor.role === 'parent_guardian') {
      membersQuery = membersQuery.join('student_guardians as sg', 'sg.student_id', 'm.student_id')
        .join('students as s', 's.id', 'sg.student_id')
        .join('campuses as c', 'c.id', 's.campus_id')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .where({ 'g.user_id': actor.sub, 'g.organization_id': actor.orgId,
          'sg.is_verified': true, 's.campus_id': actor.activeCampusId,
          'c.organization_id': actor.orgId });
    } else return { loans: [], reservations: [], fines: [] };
    const members = await membersQuery.select('m.id');
    const ids = members.map((row) => row.id);
    if (!ids.length) return { loans: [], reservations: [], fines: [] };
    const [loans, reservations, fines] = await Promise.all([
      this.db('library_loans as l').join('library_books as b', function joinBook() {
        this.on('b.id', '=', 'l.book_id').andOn('b.organization_id', '=', 'l.organization_id')
          .andOn('b.campus_id', '=', 'l.campus_id');
      })
        .where({ 'l.organization_id': actor.orgId, 'l.campus_id': actor.activeCampusId })
        .whereIn('l.member_id', ids).orderBy('l.issued_on', 'desc').limit(1000)
        .select('l.*', 'b.title', 'b.author', 'b.isbn'),
      this.db('library_reservations as r').join('library_books as b', function joinBook() {
        this.on('b.id', '=', 'r.book_id').andOn('b.organization_id', '=', 'r.organization_id')
          .andOn('b.campus_id', '=', 'r.campus_id');
      })
        .where({ 'r.organization_id': actor.orgId, 'r.campus_id': actor.activeCampusId })
        .whereIn('r.member_id', ids).orderBy('r.queue_position').limit(1000)
        .select('r.*', 'b.title', 'b.author', 'b.isbn'),
      this.db('library_fines').where({ organization_id: actor.orgId,
        campus_id: actor.activeCampusId }).whereIn('member_id', ids).limit(1000)
    ]);
    return {
      loans: loans.map((row) => ({ ...mapLoan(row), book: {
        id: row.book_id, title: row.title, author: row.author, isbn: row.isbn
      } })),
      reservations: reservations.map((row) => ({ ...mapReservation(row), book: {
        id: row.book_id, title: row.title, author: row.author, isbn: row.isbn
      } })),
      fines: fines.map(mapFine)
    };
  }
};
