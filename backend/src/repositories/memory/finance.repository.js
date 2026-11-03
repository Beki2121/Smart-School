import { randomUUID } from 'node:crypto';
import { addisDate, feeConflict, now, setupConflict, campusScopeError } from '../shared.js';
import { feeInvoiceBalance, feeInvoiceView, moneyCents, roundMoney } from '../fees.mappers.js';

const centsToAmount = (value) => roundMoney(Number(value) / 100);
const amountToCents = (value) => moneyCents(Number(value));

function scoped(actor, item) {
  return item.organizationId === actor.orgId && item.campusId === actor.activeCampusId;
}

function studentScoped(repo, actor, item) {
  const organizationId = item.organizationId ??
    repo.campuses.find((campus) => campus.id === item.campusId)?.organizationId;
  return item.campusId === actor.activeCampusId && organizationId === actor.orgId;
}

function activeInvoices(repo, actor, studentId, periodKey) {
  return repo.feeInvoices.filter((invoice) => scoped(actor, invoice) &&
    invoice.studentId === studentId && !['paid', 'void'].includes(invoice.status) &&
    (!periodKey || String(invoice.dueDate ?? '').startsWith(periodKey)) &&
    feeInvoiceBalance(invoice, repo.feePayments, repo.feeAdjustments) > 0);
}

function feeStructurePreview(repo, structure, sectionId, actor) {
  if (sectionId && !repo.sections.some((section) => section.id === sectionId &&
    section.campusId === actor.activeCampusId && section.gradeLevelId === structure.gradeLevelId &&
    section.academicYearId === structure.academicYearId)) {
    throw campusScopeError('Selected section is outside the fee structure grade and year.');
  }
  const sections = repo.sections.filter((section) => section.campusId === actor.activeCampusId &&
    section.gradeLevelId === structure.gradeLevelId &&
    section.academicYearId === structure.academicYearId &&
    (!sectionId || section.id === sectionId));
  const sectionIds = new Set(sections.map((section) => section.id));
  const eligible = repo.enrolments.filter((entry) => entry.academicYearId === structure.academicYearId &&
    entry.status === 'active' && sectionIds.has(entry.sectionId))
    .map((entry) => repo.students.find((student) => student.id === entry.studentId &&
      studentScoped(repo, actor, student) && !student.archivedAt)).filter(Boolean);
  const installments = repo.feeStructureInstallments.filter((item) =>
    item.structureId === structure.id && scoped(actor, item));
  return {
    structureId: structure.id, sectionId: sectionId ?? null,
    currencyCode: structure.currencyCode, studentCount: eligible.length, installments,
    eligibleStudents: eligible.map((student) => ({
      studentId: student.id, studentNo: student.studentNo,
      studentName: `${student.givenNameEn} ${student.fatherNameEn}`
    })),
    skippedStudents: eligible.filter((student) => installments.some((installment) =>
      repo.feeStructureInvoices.some((row) => row.structureId === structure.id &&
        row.studentId === student.id && row.installmentId === installment.id)))
      .map((student) => student.id)
  };
}

function audit(actor, action, entityType, entityId, before, after) {
  return this.appendAudit(actor, action, entityType, entityId, before, after);
}

function addNotification(repo, actor, userId, sourceType, sourceId, title, body) {
  if (repo.userNotifications.some((item) =>
    item.userId === userId && item.sourceType === sourceType && item.sourceId === sourceId)) return;
  repo.userNotifications.unshift({
    id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
    userId, sourceType, sourceId, titleEn: title, titleAm: title,
    bodyEn: body, bodyAm: body, readAt: null, createdAt: now()
  });
}

function accountBalance(repo, account) {
  return account.openingBalanceMinor + repo.cashbookEntries
    .filter((entry) => entry.accountId === account.id)
    .reduce((balance, entry) => balance +
      (entry.direction === 'credit' ? entry.amountMinor : -entry.amountMinor), 0);
}

export const memoryFinanceBundle = {
  async listFeeStructures(actor) {
    return this.feeStructures.filter((item) => scoped(actor, item));
  },
  async createFeeStructure(data, actor) {
    const grade = this.gradeLevels.find((item) =>
      item.id === data.gradeLevelId && item.campusId === actor.activeCampusId &&
      (item.organizationId ?? this.campuses.find((campus) =>
        campus.id === item.campusId)?.organizationId) === actor.orgId);
    const year = this.academicYears.find((item) =>
      item.id === data.academicYearId && item.campusId === actor.activeCampusId &&
      (item.organizationId ?? this.campuses.find((campus) =>
        campus.id === item.campusId)?.organizationId) === actor.orgId);
    if (!grade || !year) throw campusScopeError('Fee structure context is outside the active campus.');
    if (this.feeStructures.some((item) => scoped(actor, item) &&
      item.academicYearId === year.id && item.gradeLevelId === grade.id &&
      item.name.toLowerCase() === data.name.toLowerCase() && item.status !== 'archived')) {
      throw setupConflict('An active fee structure with this name already exists for the grade and year.');
    }
    const id = randomUUID();
    const structure = {
      id, organizationId: actor.orgId, campusId: actor.activeCampusId,
      academicYearId: year.id, gradeLevelId: grade.id, name: data.name,
      currencyCode: data.currencyCode, status: 'active', createdBy: actor.sub,
      createdAt: now()
    };
    const installments = data.installments.map((item, index) => ({
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      structureId: id, installmentNumber: index + 1, dueDate: item.dueDate,
      amountMinor: item.amountMinor
    }));
    if (!installments.length || installments.some((item) => item.amountMinor <= 0)) {
      throw setupConflict('A fee structure needs positive installments.');
    }
    this.feeStructures.push(structure);
    this.feeStructureInstallments.push(...installments);
    await audit.call(this, actor, 'fee_structure.created', 'fee_structure', id, null, {
      ...structure, installments
    });
    return { ...structure, installments };
  },
  async previewFeeStructureInvoices(structureId, sectionId, actor) {
    const structure = this.feeStructures.find((item) =>
      item.id === structureId && scoped(actor, item));
    if (!structure) return null;
    return feeStructurePreview(this, structure, sectionId, actor);
  },
  async generateFeeStructureInvoices(structureId, sectionId, idempotencyKey, actor) {
    const priorBatch = this.feeInvoiceGenerations.find((item) =>
      scoped(actor, item) && item.structureId === structureId && item.idempotencyKey === idempotencyKey);
    if (priorBatch) return {
      generationId: priorBatch.id,
      invoices: this.feeStructureInvoices.filter((item) => item.generationId === priorBatch.id)
        .map((item) => this.feeInvoices.find((invoice) => invoice.id === item.invoiceId))
        .filter(Boolean).map((invoice) => feeInvoiceView(invoice, this.feePayments, this.feeAdjustments)),
      duplicate: true
    };
    const structure = this.feeStructures.find((item) =>
      item.id === structureId && scoped(actor, item));
    if (!structure) return null;
    const preview = feeStructurePreview(this, structure, sectionId, actor);
    if (!preview) return null;
    const batch = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      structureId, idempotencyKey, targetSectionId: sectionId ?? null,
      invoiceCount: 0, createdAt: now()
    };
    const skipped = new Set(preview.skippedStudents);
    for (const student of preview.eligibleStudents) {
      if (skipped.has(student.studentId)) continue;
      for (const installment of preview.installments) {
        if (this.feeStructureInvoices.some((row) => row.structureId === structureId &&
            row.studentId === student.studentId && row.installmentId === installment.id)) continue;
        const id = randomUUID();
        const amount = centsToAmount(installment.amountMinor);
        const invoice = {
          id, organizationId: actor.orgId, campusId: actor.activeCampusId,
          studentId: student.studentId,
          invoiceNumber: `INV-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
          currencyCode: structure.currencyCode, totalAmount: amount,
          dueDate: installment.dueDate, status: 'issued', issuedBy: actor.sub, createdAt: now(),
          lines: [{
            id: randomUUID(), feeItemId: null, descriptionEn: `${structure.name} - installment ${installment.installmentNumber}`,
            descriptionAm: `${structure.name} - installment ${installment.installmentNumber}`,
            unitAmount: amount, quantity: 1, lineTotal: amount
          }]
        };
        this.feeInvoices.unshift(invoice);
        this.feeStructureInvoices.push({
          id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
          structureId, installmentId: installment.id, studentId: student.studentId,
          invoiceId: id, generationId: batch.id
        });
        batch.invoiceCount += 1;
      }
    }
    this.feeInvoiceGenerations.push(batch);
    await audit.call(this, actor, 'fee_invoice.bulk_generated', 'fee_invoice_generation',
      batch.id, null, { structureId, sectionId: sectionId ?? null, invoiceCount: batch.invoiceCount });
    return {
      generationId: batch.id, invoiceCount: batch.invoiceCount,
      invoices: this.feeStructureInvoices.filter((item) => item.generationId === batch.id)
        .map((item) => this.feeInvoices.find((invoice) => invoice.id === item.invoiceId))
        .map((invoice) => feeInvoiceView(invoice, this.feePayments, this.feeAdjustments)),
      duplicate: false
    };
  },
  async listFeeDiscountTypes(actor) {
    return this.feeDiscountTypes.filter((item) => scoped(actor, item));
  },
  async createFeeDiscountType(data, actor) {
    if (this.feeDiscountTypes.some((item) => scoped(actor, item) && item.code === data.code)) {
      throw setupConflict('Discount type code already exists.');
    }
    const item = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, isActive: true
    };
    this.feeDiscountTypes.push(item);
    await audit.call(this, actor, 'fee_discount_type.created', 'fee_discount_type', item.id, null, item);
    return item;
  },
  async listFeeDiscountRequests(actor) {
    return this.feeDiscountRequests.filter((item) => scoped(actor, item));
  },
  async requestFeeDiscount(data, actor) {
    const prior = this.feeDiscountRequests.find((item) =>
      scoped(actor, item) && item.idempotencyKey === data.idempotencyKey);
    if (prior) return { ...prior, duplicate: true };
    const student = this.students.find((item) =>
      item.id === data.studentId && studentScoped(this, actor, item) && !item.archivedAt);
    const type = this.feeDiscountTypes.find((item) =>
      item.id === data.discountTypeId && scoped(actor, item) && item.isActive);
    if (!student || !type) throw campusScopeError('Student or discount type is outside the active campus.');
    if ((type.discountKind === 'percentage' && (!data.percentageBasisPoints ||
        data.percentageBasisPoints > 10000)) ||
        (type.discountKind === 'fixed' && (!data.fixedAmountMinor || data.fixedAmountMinor <= 0))) {
      throw setupConflict('Discount value does not match the discount type.');
    }
    const request = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'pending', requestedBy: actor.sub, approvedBy: null,
      createdAt: now(), updatedAt: now()
    };
    this.feeDiscountRequests.unshift(request);
    await audit.call(this, actor, 'fee_discount.requested', 'fee_discount_request',
      request.id, null, request);
    const principal = this.users.find((user) => user.orgId === actor.orgId &&
      user.isActive !== false && user.role === 'principal' &&
      user.campusIds?.includes(actor.activeCampusId));
    if (principal) addNotification(this, actor, principal.id, 'fee_discount_request',
      request.id, 'Discount approval requested', request.reason);
    return request;
  },
  async transitionFeeDiscount(requestId, targetStatus, actor) {
    const request = this.feeDiscountRequests.find((item) =>
      item.id === requestId && scoped(actor, item));
    if (!request) return null;
    if (targetStatus === 'approved' && request.requestedBy === actor.sub) {
      throw setupConflict('A requester cannot approve their own discount.');
    }
    if (request.status === targetStatus) return request;
    if (request.status !== 'pending' || !['approved', 'rejected', 'cancelled'].includes(targetStatus)) {
      throw setupConflict('Discount request has an invalid state transition.');
    }
    if (targetStatus === 'approved' && request.expiresOn && request.expiresOn < addisDate()) {
      throw setupConflict('Expired discounts cannot be approved.');
    }
    const before = { status: request.status };
    request.status = targetStatus;
    request.approvedBy = targetStatus === 'approved' ? actor.sub : request.approvedBy;
    request.updatedAt = now();
    if (targetStatus === 'approved') {
      const invoices = activeInvoices(this, actor, request.studentId, request.periodKey);
      let fixedRemaining = request.fixedAmountMinor ?? 0;
      for (const invoice of invoices) {
        const balance = amountToCents(feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments));
        const discount = request.percentageBasisPoints != null
          ? Math.floor((balance * request.percentageBasisPoints + 5000) / 10000)
          : Math.min(balance, fixedRemaining);
        if (discount <= 0) continue;
        fixedRemaining -= discount;
        const application = {
          id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
          discountRequestId: request.id, invoiceId: invoice.id, amountMinor: discount
        };
        this.feeDiscountApplications.push(application);
        this.feeAdjustments.push({
          id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
          invoiceId: invoice.id, discountApplicationId: application.id,
          adjustmentType: 'credit', amountMinor: discount, reason: request.reason,
          createdBy: actor.sub, createdAt: now()
        });
      }
    }
    await audit.call(this, actor, `fee_discount.${targetStatus}`, 'fee_discount_request',
      request.id, before, {
        status: request.status, approvedBy: request.approvedBy,
        applications: this.feeDiscountApplications.filter((item) =>
          item.discountRequestId === request.id)
      });
    addNotification(this, actor, request.requestedBy, 'fee_discount_status', request.id,
      'Discount request updated', request.status);
    return request;
  },
  async requestFeeRefund(data, actor) {
    const prior = this.feeRefundRequests.find((item) =>
      scoped(actor, item) && item.idempotencyKey === data.idempotencyKey);
    if (prior) return { ...prior, duplicate: true };
    const payment = this.feePayments.find((item) => item.id === data.paymentId &&
      scoped(actor, item) && item.entryType === 'payment');
    if (!payment) throw campusScopeError('Payment is outside the active campus.');
    const priorRefunds = this.feeRefundRequests.filter((item) =>
      item.paymentId === payment.id && item.status === 'approved')
      .reduce((sum, item) => sum + item.amountMinor, 0);
    const priorReversals = this.feePayments.filter((item) =>
      item.entryType === 'reversal' && item.reversesPaymentId === payment.id)
      .reduce((sum, item) => sum + amountToCents(item.amount), 0);
    const pending = this.feeRefundRequests.filter((item) =>
      item.paymentId === payment.id && item.status === 'pending')
      .reduce((sum, item) => sum + item.amountMinor, 0);
    if (data.amountMinor > amountToCents(payment.amount) - priorRefunds - priorReversals - pending) {
      throw feeConflict('Refund requests exceed the remaining refundable payment amount.');
    }
    const request = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'pending', requestedBy: actor.sub, approvedBy: null,
      createdAt: now(), updatedAt: now()
    };
    this.feeRefundRequests.unshift(request);
    await audit.call(this, actor, 'fee_refund.requested', 'fee_refund_request', request.id, null, request);
    const principal = this.users.find((user) => user.orgId === actor.orgId &&
      user.isActive !== false && user.role === 'principal' &&
      user.campusIds?.includes(actor.activeCampusId));
    if (principal) addNotification(this, actor, principal.id, 'fee_refund_request', request.id,
      'Refund approval requested', request.reason);
    return request;
  },
  async listFeeRefundRequests(actor) {
    return this.feeRefundRequests.filter((item) => scoped(actor, item))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },
  async transitionFeeRefund(requestId, targetStatus, actor) {
    const request = this.feeRefundRequests.find((item) => item.id === requestId && scoped(actor, item));
    if (!request) return null;
    if (targetStatus === 'approved' && request.requestedBy === actor.sub) {
      throw setupConflict('A requester cannot approve their own refund.');
    }
    if (request.status === targetStatus) return request;
    if (request.status !== 'pending' || !['approved', 'rejected'].includes(targetStatus)) {
      throw setupConflict('Refund request has an invalid state transition.');
    }
    const payment = this.feePayments.find((item) => item.id === request.paymentId &&
      scoped(actor, item) && item.entryType === 'payment');
    if (!payment) throw campusScopeError('Payment is outside the active campus.');
    const previousRefunds = this.feeRefundRequests.filter((item) =>
      item.paymentId === payment.id && item.status === 'approved')
      .reduce((sum, item) => sum + item.amountMinor, 0);
    const previousReversals = this.feePayments.filter((item) =>
      item.entryType === 'reversal' && item.reversesPaymentId === payment.id)
      .reduce((sum, item) => sum + amountToCents(item.amount), 0);
    const invoice = this.feeInvoices.find((item) => item.id === payment.invoiceId && scoped(actor, item));
    if (!invoice) throw campusScopeError('Invoice is outside the active campus.');
    const before = { status: request.status, invoiceBalance: feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments) };
    request.status = targetStatus;
    request.approvedBy = targetStatus === 'approved' ? actor.sub : null;
    request.updatedAt = now();
    if (targetStatus === 'approved') {
      if (request.amountMinor > amountToCents(payment.amount) - previousRefunds - previousReversals) {
        throw feeConflict('Refund exceeds the remaining refundable payment amount.');
      }
      const reversal = {
        id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        invoiceId: invoice.id, receiptNumber: null, entryType: 'reversal',
        reversesPaymentId: payment.id, amount: centsToAmount(request.amountMinor),
        method: payment.method, reason: request.reason, recordedBy: actor.sub,
        cashierShiftId: null, currencyCode: invoice.currencyCode, recordedOn: addisDate(), recordedAt: now()
      };
      this.feePayments.push(reversal);
      request.refundPaymentId = reversal.id;
      const balance = feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments);
      if (balance < 0) throw feeConflict('Refund would create a negative invoice balance.');
      invoice.status = moneyCents(balance) === 0 ? 'paid' :
        moneyCents(balance) === moneyCents(invoice.totalAmount) ? 'issued' : 'partially_paid';
    }
    await audit.call(this, actor, `fee_refund.${targetStatus}`, 'fee_refund_request',
      request.id, before, {
        status: request.status, approvedBy: request.approvedBy,
        refundPaymentId: request.refundPaymentId ?? null,
        invoiceBalance: feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments)
      });
    addNotification(this, actor, request.requestedBy, 'fee_refund_status', request.id,
      'Refund request updated', request.status);
    return request;
  },
  async requestFeeAdjustment(data, actor) {
    const prior = this.feeAdjustmentRequests.find((item) =>
      scoped(actor, item) && item.idempotencyKey === data.idempotencyKey);
    if (prior) return { ...prior, duplicate: true };
    const invoice = this.feeInvoices.find((item) => item.id === data.invoiceId && scoped(actor, item));
    if (!invoice || invoice.status === 'void') throw campusScopeError('Invoice is outside the active campus.');
    const request = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'pending', requestedBy: actor.sub, approvedBy: null,
      createdAt: now(), updatedAt: now()
    };
    this.feeAdjustmentRequests.unshift(request);
    await audit.call(this, actor, 'fee_adjustment.requested', 'fee_adjustment_request',
      request.id, null, request);
    const principal = this.users.find((user) => user.orgId === actor.orgId &&
      user.isActive !== false && user.role === 'principal' &&
      user.campusIds?.includes(actor.activeCampusId));
    if (principal) addNotification(this, actor, principal.id, 'fee_adjustment_request',
      request.id, 'Adjustment approval requested', request.reason);
    return request;
  },
  async listFeeAdjustmentRequests(actor) {
    return this.feeAdjustmentRequests.filter((item) => scoped(actor, item))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },
  async transitionFeeAdjustment(requestId, targetStatus, actor) {
    const request = this.feeAdjustmentRequests.find((item) => item.id === requestId && scoped(actor, item));
    if (!request) return null;
    if (targetStatus === 'approved' && request.requestedBy === actor.sub) {
      throw setupConflict('A requester cannot approve their own adjustment.');
    }
    if (request.status === targetStatus) return request;
    if (request.status !== 'pending' || !['approved', 'rejected'].includes(targetStatus)) {
      throw setupConflict('Adjustment request has an invalid state transition.');
    }
    const invoice = this.feeInvoices.find((item) => item.id === request.invoiceId && scoped(actor, item));
    if (!invoice) throw campusScopeError('Invoice is outside the active campus.');
    const before = { status: request.status, balanceDue: feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments) };
    if (targetStatus === 'approved') {
      const currentBalance = amountToCents(before.balanceDue);
      if (request.adjustmentType === 'credit' && request.amountMinor > currentBalance) {
        throw feeConflict('Credit adjustment exceeds the outstanding invoice balance.');
      }
      const nextBalance = currentBalance + (request.adjustmentType === 'debit'
        ? request.amountMinor : -request.amountMinor);
      if (nextBalance < 0) throw feeConflict('Adjustment would create a negative invoice balance.');
      const adjustment = {
        id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        invoiceId: invoice.id, requestId: request.id, adjustmentType: request.adjustmentType,
        amountMinor: request.amountMinor, reason: request.reason, createdBy: actor.sub, createdAt: now()
      };
      this.feeAdjustments.push(adjustment);
      request.adjustmentId = adjustment.id;
      invoice.status = nextBalance === 0 ? 'paid' :
        nextBalance === amountToCents(invoice.totalAmount) ? 'issued' : 'partially_paid';
    }
    request.status = targetStatus;
    request.approvedBy = targetStatus === 'approved' ? actor.sub : null;
    request.updatedAt = now();
    await audit.call(this, actor, `fee_adjustment.${targetStatus}`, 'fee_adjustment_request',
      request.id, before, {
        status: request.status, approvedBy: request.approvedBy,
        adjustmentId: request.adjustmentId ?? null,
        balanceDue: feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments)
      });
    addNotification(this, actor, request.requestedBy, 'fee_adjustment_status', request.id,
      'Adjustment request updated', request.status);
    return request;
  },
  async getArrearsReport(asOf, actor) {
    const today = asOf ?? addisDate();
    return this.feeInvoices.filter((invoice) => scoped(actor, invoice) &&
      !['paid', 'void'].includes(invoice.status))
      .map((invoice) => {
        const balanceDue = feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments);
        if (balanceDue <= 0 || !invoice.dueDate) return null;
        const daysOverdue = Math.max(0, Math.floor(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${invoice.dueDate}T00:00:00Z`)) / 86400000
        ));
        const bucket = daysOverdue === 0 ? 'current' : daysOverdue <= 30 ? '1_30' :
          daysOverdue <= 60 ? '31_60' : daysOverdue <= 90 ? '61_90' : 'over_90';
        const student = this.students.find((item) =>
          item.id === invoice.studentId && studentScoped(this, actor, item));
        const section = this.sections.find((item) =>
          item.campusId === actor.activeCampusId && item.name === student?.sectionName);
        return {
          invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, studentId: student?.id,
          studentNo: student?.studentNo ?? '', studentName: `${student?.givenNameEn ?? ''} ${student?.fatherNameEn ?? ''}`.trim(),
          sectionId: section?.id ?? null, sectionName: section?.name ?? '',
          dueDate: invoice.dueDate, daysOverdue, bucket, balanceDue, currencyCode: invoice.currencyCode,
          followups: this.feeArrearsFollowups.filter((item) => item.invoiceId === invoice.id && scoped(actor, item))
        };
      }).filter(Boolean).sort((a, b) => b.daysOverdue - a.daysOverdue);
  },
  async createArrearsFollowup(invoiceId, data, actor) {
    const invoice = this.feeInvoices.find((item) => item.id === invoiceId && scoped(actor, item));
    if (!invoice || feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments) <= 0) return null;
    const followup = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      invoiceId, ...data, createdBy: actor.sub, createdAt: now()
    };
    this.feeArrearsFollowups.unshift(followup);
    await audit.call(this, actor, 'fee_arrears.followup_created', 'fee_arrears_followup',
      followup.id, null, followup);
    return followup;
  },
  async getStudentFeeStatement(studentId, actor) {
    const allowedCampuses = new Set(actor.role === 'parent_guardian' || actor.role === 'student'
      ? actor.campusIds ?? [actor.activeCampusId] : [actor.activeCampusId]);
    const student = this.students.find((item) => item.id === studentId &&
      allowedCampuses.has(item.campusId) && !item.archivedAt &&
      (item.organizationId ?? this.campuses.find((campus) =>
        campus.id === item.campusId)?.organizationId) === actor.orgId);
    if (!student) {
      throw campusScopeError('Student is outside the active campus.');
    }
    if (actor.role === 'parent_guardian' && !this.studentGuardians.some((link) =>
      link.studentId === studentId && link.isVerified && link.canViewFees &&
      this.guardians.some((guardian) => guardian.id === link.guardianId &&
        guardian.userId === actor.sub && guardian.orgId === actor.orgId))) {
      throw campusScopeError('Parent does not have fee access to this student.');
    }
    if (actor.role === 'student' && student?.userId !== actor.sub) {
      throw campusScopeError('Student can only view their own statement.');
    }
    const scopedActor = { ...actor, activeCampusId: student.campusId };
    const invoices = this.feeInvoices.filter((item) => scoped(scopedActor, item) &&
      item.studentId === studentId && item.status !== 'void')
      .map((invoice) => feeInvoiceView(invoice, this.feePayments, this.feeAdjustments));
    return { studentId, studentNo: student?.studentNo ?? '', invoices };
  },
  async getFeeReport(type, from, to, actor) {
    if (type === 'outstanding') {
      return this.feeInvoices.filter((item) => scoped(actor, item) && item.dueDate >= from &&
        item.dueDate <= to && item.status !== 'void')
        .map((invoice) => ({
          invoiceNumber: invoice.invoiceNumber, studentId: invoice.studentId,
          studentName: (() => {
            const student = this.students.find((item) => item.id === invoice.studentId &&
              studentScoped(this, actor, item));
            return student ? `${student.givenNameEn} ${student.fatherNameEn}` : '';
          })(),
          date: invoice.dueDate, currencyCode: invoice.currencyCode,
          amount: feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments)
        })).filter((row) => row.amount > 0);
    }
    const payments = this.feePayments.filter((item) => scoped(actor, item) &&
      item.recordedOn >= from && item.recordedOn <= to &&
      (type !== 'daily_cash' || item.method === 'cash'));
    const rows = payments.map((payment) => {
      const invoice = this.feeInvoices.find((item) => item.id === payment.invoiceId && scoped(actor, item));
      const student = this.students.find((item) => item.id === invoice?.studentId);
      const section = this.sections.find((item) =>
        item.campusId === actor.activeCampusId && item.name === student?.sectionName);
      const lines = invoice?.lines ?? [];
      const categories = [...new Set(lines.map((line) => this.feeItems.find((item) =>
        item.id === line.feeItemId)?.category ?? 'installment'))];
      return {
        date: payment.recordedOn, invoiceNumber: invoice?.invoiceNumber ?? '',
        studentId: invoice?.studentId ?? '', studentName: student
          ? `${student.givenNameEn} ${student.fatherNameEn}` : '',
        className: section?.name ?? '', feeTypes: categories.join(';'),
        currencyCode: invoice?.currencyCode ?? '', amount: payment.amount,
        entryType: payment.entryType, method: payment.method
      };
    });
    if (type === 'expense') {
      return this.feeExpenses.filter((item) => scoped(actor, item) &&
        item.recordedOn >= from && item.recordedOn <= to);
    }
    if (type === 'class' || type === 'fee_type' || type === 'daily_cash' ||
        type === 'daily_collection') {
      const groups = new Map();
      for (const row of rows) {
        const key = type === 'class' ? row.className || 'Unassigned'
          : type === 'fee_type' ? row.feeTypes || 'Other'
            : `${row.date}:${row.currencyCode}`;
        const label = type === 'class' ? row.className || 'Unassigned'
          : type === 'fee_type' ? row.feeTypes || 'Other' : row.date;
        const groupKey = `${key}:${row.currencyCode}`;
        const current = groups.get(groupKey) ?? {
          date: type === 'daily_cash' || type === 'daily_collection' ? row.date : undefined,
          className: type === 'class' ? label : undefined,
          feeTypes: type === 'fee_type' ? label : undefined,
          currencyCode: row.currencyCode, amountMinor: 0
        };
        current.amountMinor += (row.entryType === 'reversal' ? -1 : 1) * amountToCents(row.amount);
        groups.set(groupKey, current);
      }
      return [...groups.values()].map(({ amountMinor, ...row }) => ({
        ...row, amount: centsToAmount(amountMinor)
      }));
    }
    return rows;
  },
  async getFinanceDashboard(actor, asOf = addisDate()) {
    const start = `${asOf}T00:00:00`;
    const end = `${asOf}T23:59:59`;
    const totals = new Map();
    for (const payment of this.feePayments.filter((item) => scoped(actor, item) &&
      item.recordedOn === asOf)) {
      const row = totals.get(payment.currencyCode) ?? { currencyCode: payment.currencyCode, collected: 0 };
      row.collected += (payment.entryType === 'reversal' ? -1 : 1) * amountToCents(payment.amount);
      totals.set(payment.currencyCode, row);
    }
    const arrears = await this.getArrearsReport(asOf, actor);
    const outstanding = new Map();
    for (const invoice of this.feeInvoices.filter((item) => scoped(actor, item))) {
      const balance = amountToCents(feeInvoiceBalance(invoice, this.feePayments, this.feeAdjustments));
      if (balance > 0) outstanding.set(invoice.currencyCode,
        (outstanding.get(invoice.currencyCode) ?? 0) + balance);
    }
    return {
      date: asOf,
      collections: [...totals.values()].map((item) => ({
        currencyCode: item.currencyCode, amount: centsToAmount(item.collected)
      })),
      overdueInvoices: arrears.filter((item) => item.daysOverdue > 0).length,
      outstandingByCurrency: [...outstanding].map(([currencyCode, amount]) => ({
        currencyCode, amount: centsToAmount(amount)
      }))
    };
  },
  async listCashbookAccounts(actor) {
    return this.cashbookAccounts.filter((item) => scoped(actor, item))
      .map((item) => ({ ...item, balanceMinor: accountBalance(this, item) }));
  },
  async createCashbookAccount(data, actor) {
    const prior = this.cashbookAccounts.find((item) =>
      scoped(actor, item) && item.idempotencyKey === data.idempotencyKey);
    if (prior) return { ...prior, balanceMinor: accountBalance(this, prior), duplicate: true };
    if (this.cashbookAccounts.some((item) => scoped(actor, item) &&
      item.name.toLowerCase() === data.name.toLowerCase())) {
      throw setupConflict('Cashbook account name already exists.');
    }
    const account = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, openingBalanceMinor: data.openingBalanceMinor ?? 0,
      isActive: true, createdBy: actor.sub, createdAt: now()
    };
    this.cashbookAccounts.push(account);
    await audit.call(this, actor, 'cashbook_account.created', 'cashbook_account',
      account.id, null, account);
    return { ...account, balanceMinor: accountBalance(this, account) };
  },
  async createCashbookDeposit(accountId, data, actor) {
    const account = this.cashbookAccounts.find((item) =>
      item.id === accountId && scoped(actor, item) && item.isActive);
    if (!account) return null;
    const prior = this.cashbookEntries.find((item) =>
      scoped(actor, item) && item.idempotencyKey === data.idempotencyKey);
    if (prior) return { ...prior, duplicate: true };
    if (data.amountMinor <= 0) throw feeConflict('Deposit amount must be positive.');
    const entry = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      accountId, entryType: 'deposit', direction: 'credit', amountMinor: data.amountMinor,
      currencyCode: account.currencyCode, description: data.description,
      reference: data.reference ?? null, relatedEntryId: null,
      idempotencyKey: data.idempotencyKey, createdBy: actor.sub, recordedOn: data.recordedOn ?? addisDate(),
      createdAt: now()
    };
    this.cashbookEntries.push(entry);
    await audit.call(this, actor, 'cashbook.deposit_recorded', 'cashbook_entry', entry.id, null, entry);
    return entry;
  },
  async transferCashbookFunds(data, actor) {
    const prior = this.cashbookEntries.find((item) =>
      scoped(actor, item) && item.idempotencyKey === `${data.idempotencyKey}:debit`);
    if (prior) return { debit: prior, credit: this.cashbookEntries.find((item) =>
      item.relatedEntryId === prior.id || prior.relatedEntryId === item.id), duplicate: true };
    const from = this.cashbookAccounts.find((item) =>
      item.id === data.fromAccountId && scoped(actor, item) && item.isActive);
    const to = this.cashbookAccounts.find((item) =>
      item.id === data.toAccountId && scoped(actor, item) && item.isActive);
    if (!from || !to) throw campusScopeError('Transfer accounts are outside the active campus.');
    if (from.id === to.id || from.currencyCode !== to.currencyCode) {
      throw feeConflict('Transfers require two distinct accounts with the same currency.');
    }
    if (data.amountMinor <= 0 || accountBalance(this, from) < data.amountMinor) {
      throw feeConflict('Transfer exceeds the source account balance.');
    }
    const debit = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      accountId: from.id, entryType: 'transfer', direction: 'debit',
      amountMinor: data.amountMinor, currencyCode: from.currencyCode, description: data.description,
      reference: data.reference ?? null, relatedEntryId: null,
      idempotencyKey: `${data.idempotencyKey}:debit`, createdBy: actor.sub,
      recordedOn: data.recordedOn ?? addisDate(), createdAt: now()
    };
    const credit = {
      ...debit, id: randomUUID(), accountId: to.id, direction: 'credit',
      relatedEntryId: debit.id, idempotencyKey: `${data.idempotencyKey}:credit`
    };
    debit.relatedEntryId = credit.id;
    this.cashbookEntries.push(debit, credit);
    try {
      await audit.call(this, actor, 'cashbook.transfer_recorded', 'cashbook_transfer',
        data.idempotencyKey, null, { debit, credit });
    } catch (error) {
      this.cashbookEntries.splice(this.cashbookEntries.indexOf(debit), 1);
      this.cashbookEntries.splice(this.cashbookEntries.indexOf(credit), 1);
      throw error;
    }
    return { debit, credit };
  },
  async listCashbookEntries(accountId, from, to, actor) {
    if (!this.cashbookAccounts.some((item) => item.id === accountId && scoped(actor, item))) return null;
    return this.cashbookEntries.filter((item) => scoped(actor, item) && item.accountId === accountId &&
      item.recordedOn >= from && item.recordedOn <= to)
      .sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
  },
  async reconcileCashbookAccount(accountId, data, actor) {
    const prior = this.cashbookReconciliations.find((item) =>
      item.accountId === accountId && item.statementDate === data.statementDate && scoped(actor, item));
    if (prior) return { ...prior, duplicate: true };
    const account = this.cashbookAccounts.find((item) => item.id === accountId && scoped(actor, item));
    if (!account) return null;
    const eligible = this.cashbookEntries.filter((item) => scoped(actor, item) &&
      item.accountId === accountId && item.recordedOn <= data.statementDate &&
      !this.cashbookReconciliations.some((reconciliation) =>
        this.cashbookReconciliationEntries.some((link) =>
          link.reconciliationId === reconciliation.id && link.entryId === item.id)));
    const bookBalanceMinor = account.openingBalanceMinor + this.cashbookEntries
      .filter((item) => scoped(actor, item) && item.accountId === accountId &&
        item.recordedOn <= data.statementDate)
      .reduce((sum, item) => sum + (item.direction === 'credit' ? item.amountMinor : -item.amountMinor), 0);
    const reconciliation = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      accountId, statementDate: data.statementDate, statementBalanceMinor: data.statementBalanceMinor,
      bookBalanceMinor, differenceMinor: data.statementBalanceMinor - bookBalanceMinor,
      createdBy: actor.sub, createdAt: now()
    };
    this.cashbookReconciliations.push(reconciliation);
    this.cashbookReconciliationEntries.push(...eligible.map((entry) => ({
      organizationId: actor.orgId, campusId: actor.activeCampusId,
      reconciliationId: reconciliation.id, entryId: entry.id
    })));
    await audit.call(this, actor, 'cashbook.reconciled', 'cashbook_reconciliation',
      reconciliation.id, null, reconciliation);
    return reconciliation;
  },
  async reverseCashbookEntry(entryId, data, actor) {
    const entry = this.cashbookEntries.find((item) =>
      item.id === entryId && scoped(actor, item));
    if (!entry) return null;
    const prior = this.cashbookEntries.find((item) => item.relatedEntryId === entryId &&
      item.entryType === 'reversal');
    if (prior) return { ...prior, duplicate: true };
    const account = this.cashbookAccounts.find((item) => item.id === entry.accountId && scoped(actor, item));
    const direction = entry.direction === 'credit' ? 'debit' : 'credit';
    if (direction === 'debit' && accountBalance(this, account) < entry.amountMinor) {
      throw feeConflict('Cashbook reversal would create a negative account balance.');
    }
    const reversal = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      accountId: entry.accountId, entryType: 'reversal', direction,
      amountMinor: entry.amountMinor, currencyCode: entry.currencyCode,
      description: data.reason, reference: entry.reference, relatedEntryId: entry.id,
      idempotencyKey: data.idempotencyKey, createdBy: actor.sub, recordedOn: addisDate(), createdAt: now()
    };
    this.cashbookEntries.push(reversal);
    await audit.call(this, actor, 'cashbook.entry_reversed', 'cashbook_entry',
      entry.id, entry, reversal);
    return reversal;
  }
};
