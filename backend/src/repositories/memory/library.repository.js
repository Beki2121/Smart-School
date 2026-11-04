import { randomUUID } from 'node:crypto';
import { now } from '../shared.js';
import { addDays, addisDate } from '../../utils/dates.js';

function libraryError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function scoped(rows, actor) {
  return rows.filter((row) => row.organizationId === actor.orgId &&
    row.campusId === actor.activeCampusId);
}

function mapMember(member, repo) {
  const person = member.memberType === 'student'
    ? repo.students.find((row) => row.id === member.studentId &&
      row.organizationId === member.organizationId && row.campusId === member.campusId)
    : repo.staff.find((row) => row.id === member.staffId &&
      row.organizationId === member.organizationId && row.campusId === member.campusId);
  return { ...structuredClone(member), name: person
    ? [person.givenNameEn, person.fatherNameEn, person.grandfatherNameEn].filter(Boolean).join(' ')
    : '', studentNo: person?.studentNo ?? null };
}

export const memoryLibraryBundle = {
  initLibrary() {
    this.librarySettings ??= [];
    this.libraryCategories ??= [];
    this.libraryBooks ??= [];
    this.libraryCopies ??= [];
    this.libraryMembers ??= [];
    this.libraryLoans ??= [];
    this.libraryReservations ??= [];
    this.libraryFines ??= [];
  },
  async libraryAudit(actor, action, entityType, entityId, before, after) {
    await this.appendAudit(actor, `library.${action}`, entityType, entityId, before, after);
  },
  async libraryNotify(member, sourceType, sourceId, title, body) {
    const userId = member.memberType === 'student'
      ? this.students.find((row) => row.id === member.studentId)?.userId
      : this.staff.find((row) => row.id === member.staffId)?.userId;
    if (!userId || this.userNotifications.some((row) =>
      row.userId === userId && row.sourceType === sourceType && row.sourceId === sourceId)) return;
    this.userNotifications.unshift({
      id: randomUUID(), organizationId: member.organizationId, campusId: member.campusId,
      userId, sourceType, sourceId, titleEn: title, titleAm: title,
      bodyEn: body, bodyAm: body, readAt: null, createdAt: now()
    });
  },
  async listLibraryCategories(actor) {
    this.initLibrary();
    return structuredClone(scoped(this.libraryCategories, actor).filter((row) => !row.archivedAt));
  },
  async createLibraryCategory(data, actor) {
    this.initLibrary();
    if (scoped(this.libraryCategories, actor).some((row) => row.name.toLowerCase() === data.name.toLowerCase())) {
      throw libraryError('LIBRARY_CATEGORY_DUPLICATE', 'A category with this name already exists.');
    }
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'active', archivedAt: null, createdAt: now(), updatedAt: now() };
    this.libraryCategories.push(row);
    await this.libraryAudit(actor, 'category_created', 'library_category', row.id, null, row);
    return structuredClone(row);
  },
  async updateLibraryCategory(id, data, actor) {
    this.initLibrary();
    const row = scoped(this.libraryCategories, actor).find((item) => item.id === id && !item.archivedAt);
    if (!row) return null;
    const before = structuredClone(row);
    Object.assign(row, data, { updatedAt: now() });
    await this.libraryAudit(actor, 'category_updated', 'library_category', id, before, row);
    return structuredClone(row);
  },
  async listLibraryBooks(query, actor) {
    this.initLibrary();
    const search = query.search?.toLowerCase();
    return scoped(this.libraryBooks, actor).filter((book) =>
      (!book.archivedAt || query.status === 'archived') &&
      (!query.status || book.status === query.status) &&
      (!query.categoryId || book.categoryId === query.categoryId) &&
      (!search || [book.title, book.author, book.isbn, book.publisher].some((value) =>
        value?.toLowerCase().includes(search))))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((book) => ({ ...structuredClone(book), copies: scoped(this.libraryCopies, actor)
        .filter((copy) => copy.bookId === book.id && !copy.archivedAt)
        .map((copy) => structuredClone(copy)) }));
  },
  async createLibraryBook(data, actor) {
    this.initLibrary();
    if (data.isbn && this.libraryBooks.some((row) =>
      row.organizationId === actor.orgId && row.isbn === data.isbn)) {
      throw libraryError('LIBRARY_ISBN_DUPLICATE', 'A book with this ISBN already exists.');
    }
    if (data.categoryId && !scoped(this.libraryCategories, actor).some((row) =>
      row.id === data.categoryId && !row.archivedAt)) {
      throw libraryError('LIBRARY_CATEGORY_NOT_FOUND', 'Category not found.', 404);
    }
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, isbn: data.isbn || null, status: 'active', archivedAt: null,
      createdAt: now(), updatedAt: now() };
    this.libraryBooks.push(row);
    await this.libraryAudit(actor, 'book_created', 'library_book', row.id, null, row);
    return structuredClone(row);
  },
  async updateLibraryBook(id, data, actor) {
    this.initLibrary();
    const row = scoped(this.libraryBooks, actor).find((item) => item.id === id && !item.archivedAt);
    if (!row) return null;
    if (data.categoryId && !scoped(this.libraryCategories, actor).some((item) =>
      item.id === data.categoryId && !item.archivedAt)) {
      throw libraryError('LIBRARY_CATEGORY_NOT_FOUND', 'Category not found.', 404);
    }
    if (data.isbn && this.libraryBooks.some((item) => item.id !== id &&
        item.organizationId === actor.orgId && item.isbn === data.isbn)) {
      throw libraryError('LIBRARY_ISBN_DUPLICATE', 'A book with this ISBN already exists.');
    }
    const before = structuredClone(row);
    Object.assign(row, data, { updatedAt: now() });
    await this.libraryAudit(actor, 'book_updated', 'library_book', id, before, row);
    return structuredClone(row);
  },
  async archiveLibraryBook(id, actor) {
    this.initLibrary();
    const row = scoped(this.libraryBooks, actor).find((item) => item.id === id);
    if (!row) return null;
    const before = structuredClone(row);
    row.status = 'archived'; row.archivedAt = now(); row.updatedAt = now();
    await this.libraryAudit(actor, 'book_archived', 'library_book', id, before, row);
    return structuredClone(row);
  },
  async listLibraryCopies(query, actor) {
    this.initLibrary();
    const search = query.search?.toLowerCase();
    return scoped(this.libraryCopies, actor).filter((copy) => {
      const book = this.libraryBooks.find((item) => item.id === copy.bookId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
      return (!copy.archivedAt || query.status === 'archived') &&
        (!query.status || copy.status === query.status) &&
        (!query.barcode || copy.barcode === query.barcode) &&
        (!query.categoryId || book?.categoryId === query.categoryId) &&
        (!search || [copy.barcode, copy.copyNumber, copy.shelfLocation, book?.title,
          book?.author, book?.isbn].some((value) => value?.toLowerCase().includes(search)));
    }).map((copy) => ({
      ...structuredClone(copy),
      book: structuredClone(this.libraryBooks.find((book) => book.id === copy.bookId) ?? null)
    }));
  },
  async findLibraryCopyByBarcode(barcode, actor) {
    return (await this.listLibraryCopies({ barcode }, actor))[0] ?? null;
  },
  async createLibraryCopy(data, actor) {
    this.initLibrary();
    const book = scoped(this.libraryBooks, actor).find((row) => row.id === data.bookId &&
      row.status === 'active' && !row.archivedAt);
    if (!book) throw libraryError('LIBRARY_BOOK_NOT_FOUND', 'Active book not found.', 404);
    if (this.libraryCopies.some((row) => row.organizationId === actor.orgId &&
      (row.barcode === data.barcode ||
        (row.campusId === actor.activeCampusId && row.bookId === data.bookId &&
          row.copyNumber === data.copyNumber)))) {
      throw libraryError('LIBRARY_COPY_DUPLICATE', 'Barcode or copy number already exists.');
    }
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'available', archivedAt: null, createdAt: now(), updatedAt: now() };
    this.libraryCopies.push(row);
    await this.libraryAudit(actor, 'copy_created', 'library_copy', row.id, null, row);
    return structuredClone(row);
  },
  async updateLibraryCopy(id, data, actor) {
    this.initLibrary();
    const row = scoped(this.libraryCopies, actor).find((item) => item.id === id && !item.archivedAt);
    if (!row) return null;
    if (data.barcode && this.libraryCopies.some((item) => item.id !== id &&
        item.organizationId === actor.orgId && item.barcode === data.barcode)) {
      throw libraryError('LIBRARY_COPY_DUPLICATE', 'Barcode already exists.');
    }
    if (data.condition && ['damaged', 'lost'].includes(data.condition) && row.status === 'loaned') {
      throw libraryError('LIBRARY_COPY_ON_LOAN', 'Return the copy before changing it to damaged or lost.');
    }
    const before = structuredClone(row);
    const status = data.condition && ['damaged', 'lost'].includes(data.condition)
      ? data.condition
      : data.condition && ['damaged', 'lost'].includes(row.condition) ? 'available' : row.status;
    Object.assign(row, data, { status, updatedAt: now() });
    await this.libraryAudit(actor, 'copy_updated', 'library_copy', id, before, row);
    if (data.condition && data.condition !== before.condition) {
      await this.libraryAudit(actor, 'condition_changed', 'library_copy', id,
        { condition: before.condition }, { condition: row.condition });
    }
    return structuredClone(row);
  },
  async archiveLibraryCopy(id, actor) {
    this.initLibrary();
    const row = scoped(this.libraryCopies, actor).find((item) => item.id === id);
    if (!row) return null;
    if (row.status === 'loaned' || row.status === 'reserved') {
      throw libraryError('LIBRARY_COPY_ON_LOAN', 'A loaned or reserved copy cannot be archived.');
    }
    const before = structuredClone(row);
    row.status = 'archived'; row.archivedAt = now(); row.updatedAt = now();
    await this.libraryAudit(actor, 'copy_archived', 'library_copy', id, before, row);
    return structuredClone(row);
  },
  async listLibraryMembers(actor) {
    this.initLibrary();
    return scoped(this.libraryMembers, actor).map((member) => mapMember(member, this));
  },
  async addLibraryMember(data, actor) {
    this.initLibrary();
    const person = data.memberType === 'student'
      ? this.students.find((row) => row.id === data.studentId && row.organizationId === actor.orgId &&
        row.campusId === actor.activeCampusId && row.status === 'enrolled' && !row.archivedAt)
      : this.staff.find((row) => row.id === data.staffId && row.organizationId === actor.orgId &&
        row.campusId === actor.activeCampusId && row.employmentStatus === 'active' && !row.archivedAt);
    if (!person) throw libraryError('LIBRARY_MEMBER_INACTIVE', 'Select an active student or staff member.');
    const duplicate = scoped(this.libraryMembers, actor).find((row) =>
      (data.studentId && row.studentId === data.studentId) || (data.staffId && row.staffId === data.staffId));
    if (duplicate) return mapMember(duplicate, this);
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'active', archivedAt: null, createdAt: now(), updatedAt: now() };
    this.libraryMembers.push(row);
    await this.libraryAudit(actor, 'member_created', 'library_member', row.id, null, row);
    return mapMember(row, this);
  },
  async getLibrarySettings(actor) {
    this.initLibrary();
    return structuredClone(scoped(this.librarySettings, actor)[0] ?? {
      loanPeriodDays: 14, maxActiveLoans: 5, maxRenewals: 2, fineMinorPerDay: 100,
      currencyCode: this.organizations.find((org) => org.id === actor.orgId)?.currencyCode ?? 'ETB'
    });
  },
  async updateLibrarySettings(data, actor) {
    this.initLibrary();
    let row = scoped(this.librarySettings, actor)[0];
    if (!row) {
      row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        ...data, createdAt: now(), updatedAt: now() };
      this.librarySettings.push(row);
      await this.libraryAudit(actor, 'settings_created', 'library_settings', row.id, null, row);
    } else {
      const before = structuredClone(row);
      Object.assign(row, data, { updatedAt: now() });
      await this.libraryAudit(actor, 'settings_updated', 'library_settings', row.id, before, row);
    }
    return structuredClone(row);
  },
  async getLibraryDashboard(actor) {
    this.initLibrary();
    const copies = scoped(this.libraryCopies, actor).filter((row) => !row.archivedAt);
    const loans = scoped(this.libraryLoans, actor).filter((row) => row.status === 'active');
    const today = addisDate();
    return { total: copies.length, available: copies.filter((row) =>
      row.status === 'available' || row.status === 'reserved').length,
    borrowed: loans.length, overdue: loans.filter((row) => row.dueOn < today).length };
  },
  async listLibraryLoans(status, actor) {
    this.initLibrary();
    await this.emitLibraryLoanNotifications(actor);
    return scoped(this.libraryLoans, actor).filter((row) => !status || row.status === status)
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn)).map((loan) => ({
        ...structuredClone(loan),
        copy: structuredClone(this.libraryCopies.find((row) => row.id === loan.copyId) ?? null),
        book: structuredClone(this.libraryBooks.find((row) => row.id === loan.bookId) ?? null),
        member: mapMember(this.libraryMembers.find((row) => row.id === loan.memberId), this),
        fine: structuredClone(this.libraryFines.find((row) => row.loanId === loan.id) ?? null)
      }));
  },
  async emitLibraryLoanNotifications(actor) {
    const today = new Date().toISOString().slice(0, 10);
    for (const loan of scoped(this.libraryLoans, actor).filter((row) =>
      row.status === 'active' && row.dueOn <= addDays(today, 3))) {
      const member = scoped(this.libraryMembers, actor).find((row) => row.id === loan.memberId);
      if (member) await this.libraryNotify(member, loan.dueOn < today
        ? 'library_overdue' : 'library_due_soon', loan.id,
      loan.dueOn < today ? 'Library book overdue' : 'Library book due soon',
      `A borrowed book is due on ${loan.dueOn}.`);
    }
  },
  async issueLibraryCopy(data, actor) {
    this.initLibrary();
    const repeated = scoped(this.libraryLoans, actor).find((row) => row.idempotencyKey === data.idempotencyKey);
    if (repeated) return structuredClone(repeated);
    const copy = scoped(this.libraryCopies, actor).find((row) => row.id === data.copyId);
    const member = scoped(this.libraryMembers, actor).find((row) => row.id === data.memberId &&
      row.status === 'active' && !row.archivedAt);
    if (!copy || copy.archivedAt || !['available', 'reserved'].includes(copy.status)) {
      throw libraryError('LIBRARY_COPY_UNAVAILABLE', 'Copy is unavailable for issue.');
    }
    const book = scoped(this.libraryBooks, actor).find((row) => row.id === copy.bookId &&
      row.status === 'active' && !row.archivedAt);
    if (!book || copy.condition === 'lost' || copy.condition === 'damaged') {
      throw libraryError('LIBRARY_COPY_UNAVAILABLE', 'Archived, lost, or damaged copies cannot be issued.');
    }
    if (!member) throw libraryError('LIBRARY_MEMBER_INACTIVE', 'Active library member not found.', 404);
    let ready = scoped(this.libraryReservations, actor).find((row) =>
      row.bookId === book.id && row.status === 'ready' && row.readyCopyId === copy.id);
    if (ready?.readyUntil && ready.readyUntil < addisDate()) {
      const before = structuredClone(ready);
      ready.status = 'expired'; ready.updatedAt = now();
      await this.libraryAudit(actor, 'reservation_expired', 'library_reservation', ready.id,
        before, ready);
      copy.status = 'available';
      const next = await this.fulfillLibraryReservation(copy, actor);
      if (next) copy.status = 'reserved';
      ready = scoped(this.libraryReservations, actor).find((row) =>
        row.bookId === book.id && row.memberId === member.id && row.status === 'ready' &&
        row.readyCopyId === copy.id);
    }
    if (copy.status === 'reserved' && !ready) {
      throw libraryError('LIBRARY_COPY_RESERVED', 'This copy is reserved for another member.');
    }
    if (ready && ready.memberId !== member.id) {
      throw libraryError('LIBRARY_COPY_RESERVED', 'This copy is reserved for another member.');
    }
    const settings = await this.getLibrarySettings(actor);
    const retry = scoped(this.libraryLoans, actor).find((row) => row.idempotencyKey === data.idempotencyKey);
    if (retry) return structuredClone(retry);
    if (copy.archivedAt || !['available', 'reserved'].includes(copy.status)) {
      throw libraryError('LIBRARY_COPY_UNAVAILABLE', 'Copy was issued by another request.');
    }
    const currentLoans = scoped(this.libraryLoans, actor).filter((row) =>
      row.memberId === member.id && row.status === 'active');
    if (currentLoans.length >= settings.maxActiveLoans) {
      throw libraryError('LIBRARY_LOAN_LIMIT', 'Member has reached the active loan limit.');
    }
    if (currentLoans.some((row) => row.dueOn < addisDate())) {
      throw libraryError('LIBRARY_OVERDUE_BLOCK', 'Member has an overdue loan.');
    }
    const issueDate = data.issuedOn;
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      bookId: book.id, copyId: copy.id, activeCopyId: copy.id, memberId: member.id,
      issuedOn: issueDate, dueOn: addDays(issueDate, settings.loanPeriodDays), returnedOn: null,
      status: 'active', renewalCount: 0, returnCondition: null, idempotencyKey: data.idempotencyKey,
      issuedBy: actor.sub, returnedBy: null, createdAt: now(), updatedAt: now() };
    this.libraryLoans.push(row);
    copy.status = 'loaned'; copy.updatedAt = now();
    if (ready) { ready.status = 'fulfilled'; ready.fulfilledAt = now(); ready.updatedAt = now(); }
    await this.libraryAudit(actor, 'issued', 'library_loan', row.id, null, row);
    return structuredClone(row);
  },
  async returnLibraryLoan(id, data, actor) {
    this.initLibrary();
    const row = scoped(this.libraryLoans, actor).find((item) => item.id === id);
    if (!row) return null;
    if (row.status === 'returned') {
      return { ...structuredClone(row), fine: structuredClone(this.libraryFines.find((fine) =>
        fine.loanId === row.id) ?? null) };
    }
    if (row.status !== 'active') throw libraryError('LIBRARY_LOAN_INVALID_STATE', 'Loan cannot be returned.');
    const before = structuredClone(row);
    const settings = await this.getLibrarySettings(actor);
    if (row.status === 'returned') {
      return { ...structuredClone(row), fine: structuredClone(this.libraryFines.find((fine) =>
        fine.loanId === row.id) ?? null) };
    }
    const overdueDays = Math.max(0, Math.floor((Date.parse(`${data.returnedOn}T00:00:00Z`) -
      Date.parse(`${row.dueOn}T00:00:00Z`)) / 86400000));
    let fine = null;
    if (overdueDays > 0 && settings.fineMinorPerDay > 0) {
      const amountMinor = overdueDays * settings.fineMinorPerDay;
      if (!Number.isSafeInteger(amountMinor)) {
        throw libraryError('LIBRARY_FINE_AMOUNT_INVALID', 'Calculated fine exceeds safe minor-unit precision.', 422);
      }
      fine = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        loanId: row.id, memberId: row.memberId, amountMinor,
        currencyCode: settings.currencyCode, overdueDays, status: 'unpaid', reason: '',
        waivedBy: null, paidBy: null, paidOn: null, waivedAt: null, createdAt: now(), updatedAt: now() };
      this.libraryFines.push(fine);
    }
    row.status = 'returned'; row.activeCopyId = null; row.returnedOn = data.returnedOn;
    row.returnCondition = data.returnCondition; row.returnedBy = actor.sub; row.updatedAt = now();
    const copy = scoped(this.libraryCopies, actor).find((item) => item.id === row.copyId);
    copy.condition = data.returnCondition; copy.status = ['lost', 'damaged'].includes(data.returnCondition)
      ? data.returnCondition : 'available';
    copy.updatedAt = now();
    await this.libraryAudit(actor, 'returned', 'library_loan', id, before, row);
    if (data.returnCondition !== before.returnCondition) {
      await this.libraryAudit(actor, 'condition_changed', 'library_copy', copy.id,
        { condition: before.returnCondition }, { condition: data.returnCondition });
    }
    if (fine) await this.libraryAudit(actor, 'fine_created', 'library_fine', fine.id, null, fine);
    await this.fulfillLibraryReservation(copy, actor);
    return { ...structuredClone(row), fine: structuredClone(fine) };
  },
  async fulfillLibraryReservation(copy, actor) {
    if (!copy || copy.status !== 'available') return;
    const next = scoped(this.libraryReservations, actor).filter((row) =>
      row.bookId === copy.bookId && row.status === 'queued')
      .sort((a, b) => a.queuePosition - b.queuePosition || a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return;
    next.status = 'ready'; next.readyCopyId = copy.id;
    next.readyUntil = addDays(addisDate(), 3);
    next.readyAt = now(); next.updatedAt = now();
    copy.status = 'reserved'; copy.updatedAt = now();
    await this.libraryAudit(actor, 'reservation_fulfilled', 'library_reservation', next.id,
      { status: 'queued' }, { status: 'ready', copyId: copy.id });
    await this.libraryNotify(scoped(this.libraryMembers, actor).find((item) => item.id === next.memberId),
      'library_reservation_ready', next.id, 'Library reservation ready',
      `A reserved copy is ready until ${next.readyUntil}.`);
    return next;
  },
  async renewLibraryLoan(id, data, actor) {
    this.initLibrary();
    const row = scoped(this.libraryLoans, actor).find((item) => item.id === id);
    if (!row) return null;
    if (row.status !== 'active') throw libraryError('LIBRARY_LOAN_INVALID_STATE', 'Only an active loan can be renewed.');
    const settings = await this.getLibrarySettings(actor);
    if (row.renewalCount >= settings.maxRenewals) {
      throw libraryError('LIBRARY_RENEWAL_LIMIT', 'Renewal limit has been reached.');
    }
    if (scoped(this.libraryReservations, actor).some((reservation) =>
      reservation.bookId === row.bookId && reservation.status === 'queued')) {
      throw libraryError('LIBRARY_RESERVATION_QUEUE', 'A queued reservation prevents renewal.');
    }
    const before = structuredClone(row);
    row.dueOn = data.dueOn ?? addDays(row.dueOn, settings.loanPeriodDays);
    row.renewalCount++; row.updatedAt = now();
    await this.libraryAudit(actor, 'renewed', 'library_loan', id, before, row);
    return structuredClone(row);
  },
  async listLibraryReservations(actor) {
    this.initLibrary();
    return scoped(this.libraryReservations, actor).sort((a, b) =>
      a.bookId.localeCompare(b.bookId) || a.queuePosition - b.queuePosition);
  },
  async reserveLibraryBook(data, actor) {
    this.initLibrary();
    const repeat = scoped(this.libraryReservations, actor).find((row) =>
      row.idempotencyKey === data.idempotencyKey);
    if (repeat) return structuredClone(repeat);
    const book = scoped(this.libraryBooks, actor).find((row) => row.id === data.bookId &&
      row.status === 'active' && !row.archivedAt);
    const member = scoped(this.libraryMembers, actor).find((row) => row.id === data.memberId &&
      row.status === 'active' && !row.archivedAt);
    if (!book) throw libraryError('LIBRARY_BOOK_NOT_FOUND', 'Active book not found.', 404);
    if (!member) throw libraryError('LIBRARY_MEMBER_INACTIVE', 'Active library member not found.', 404);
    const copies = scoped(this.libraryCopies, actor).filter((row) =>
      row.bookId === book.id && !row.archivedAt && !['lost', 'damaged'].includes(row.condition));
    if (copies.some((row) => row.status === 'available')) {
      throw libraryError('LIBRARY_COPY_AVAILABLE', 'A copy is available; issue it instead of reserving.');
    }
    if (scoped(this.libraryReservations, actor).some((row) => row.bookId === book.id &&
        row.memberId === member.id && ['queued', 'ready'].includes(row.status))) {
      throw libraryError('LIBRARY_RESERVATION_EXISTS', 'Member already has an active reservation.');
    }
    const queuePosition = Math.max(0, ...scoped(this.libraryReservations, actor)
      .filter((row) => row.bookId === book.id && row.status === 'queued')
      .map((row) => row.queuePosition)) + 1;
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      bookId: book.id, memberId: member.id, queuePosition, idempotencyKey: data.idempotencyKey,
      status: 'queued', readyCopyId: null, readyUntil: null, readyAt: null,
      fulfilledAt: null, cancelledAt: null, createdAt: now(), updatedAt: now() };
    this.libraryReservations.push(row);
    await this.libraryAudit(actor, 'reservation_created', 'library_reservation', row.id, null, row);
    return structuredClone(row);
  },
  async cancelLibraryReservation(id, actor) {
    this.initLibrary();
    const row = scoped(this.libraryReservations, actor).find((item) => item.id === id);
    if (!row) return null;
    if (!['queued', 'ready'].includes(row.status)) {
      throw libraryError('LIBRARY_RESERVATION_INVALID_STATE', 'Reservation cannot be cancelled.');
    }
    const before = structuredClone(row);
    if (row.status === 'ready' && row.readyCopyId) {
      const copy = scoped(this.libraryCopies, actor).find((item) => item.id === row.readyCopyId);
      if (copy) { copy.status = 'available'; await this.fulfillLibraryReservation(copy, actor); }
    }
    row.status = 'cancelled'; row.cancelledAt = now(); row.updatedAt = now();
    await this.libraryAudit(actor, 'reservation_cancelled', 'library_reservation', id, before, row);
    return structuredClone(row);
  },
  async listLibraryFines(actor) {
    this.initLibrary();
    return scoped(this.libraryFines, actor).map((fine) => ({
      ...structuredClone(fine), member: mapMember(scoped(this.libraryMembers, actor)
        .find((member) => member.id === fine.memberId), this)
    }));
  },
  async updateLibraryFine(id, data, actor) {
    this.initLibrary();
    const row = scoped(this.libraryFines, actor).find((item) => item.id === id);
    if (!row) return null;
    if (row.status !== 'unpaid') throw libraryError('LIBRARY_FINE_INVALID_STATE', 'Fine is not unpaid.');
    const before = structuredClone(row);
    Object.assign(row, { status: 'paid', paidOn: data.paidOn, paidBy: actor.sub, updatedAt: now() });
    await this.libraryAudit(actor, 'fine_paid', 'library_fine', id, before, row);
    return structuredClone(row);
  },
  async waiveLibraryFine(id, data, actor) {
    this.initLibrary();
    const row = scoped(this.libraryFines, actor).find((item) => item.id === id);
    if (!row) return null;
    if (row.status !== 'unpaid') throw libraryError('LIBRARY_FINE_INVALID_STATE', 'Fine is not unpaid.');
    const before = structuredClone(row);
    Object.assign(row, { status: 'waived', reason: data.reason, waivedBy: actor.sub,
      waivedAt: now(), updatedAt: now() });
    await this.libraryAudit(actor, 'fine_waived', 'library_fine', id, before, row);
    return structuredClone(row);
  },
  async getPortalLibrary(actor) {
    this.initLibrary();
    const students = actor.role === 'student'
      ? this.students.filter((row) => row.userId === actor.sub && row.organizationId === actor.orgId &&
        row.campusId === actor.activeCampusId)
      : actor.role === 'parent_guardian'
        ? (() => {
          const guardian = this.guardians.find((row) => row.userId === actor.sub && row.orgId === actor.orgId);
          return this.studentGuardians.filter((link) => guardian && link.guardianId === guardian.id &&
            link.isVerified).map((link) => this.students.find((student) =>
            student.id === link.studentId && student.organizationId === actor.orgId &&
            student.campusId === actor.activeCampusId)).filter(Boolean);
        })() : [];
    const staff = ['homeroom_teacher', 'subject_teacher'].includes(actor.role)
      ? this.staff.filter((row) => row.userId === actor.sub && row.organizationId === actor.orgId &&
        row.campusId === actor.activeCampusId) : [];
    const memberIds = new Set(scoped(this.libraryMembers, actor).filter((member) =>
      students.some((student) => member.studentId === student.id) ||
      staff.some((record) => member.staffId === record.id)).map((member) => member.id));
    return {
      loans: scoped(this.libraryLoans, actor).filter((row) => memberIds.has(row.memberId))
        .map((row) => ({ ...structuredClone(row), book: structuredClone(this.libraryBooks
          .find((book) => book.id === row.bookId) ?? null) })),
      reservations: scoped(this.libraryReservations, actor).filter((row) => memberIds.has(row.memberId))
        .map((row) => ({ ...structuredClone(row), book: structuredClone(this.libraryBooks
          .find((book) => book.id === row.bookId) ?? null) })),
      fines: scoped(this.libraryFines, actor).filter((row) => memberIds.has(row.memberId))
        .map((row) => structuredClone(row))
    };
  }
};
