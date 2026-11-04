import { randomUUID } from 'node:crypto';
import { addisDate } from '../shared.js';
import {
  aggregateReportRows, aggregateTeacherWorkload, reportDateRange, reportTooLarge,
  summarizeReport, syllabusCoveragePercent
} from '../../reports/aggregate.js';
import { reportCatalog, reportPage } from '../../reports/catalog.js';

const MAX_REPORT_ROWS = 10000;

function dateOnly(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return value == null ? null : String(value).slice(0, 10);
}

function dateTime(value) {
  return value instanceof Date ? value.toISOString() : value == null ? null : String(value);
}

function forbiddenReport() {
  const error = new Error('You do not have permission to view this report.');
  error.status = 403;
  error.code = 'FORBIDDEN';
  return error;
}

async function boundedRows(query) {
  const rows = await query.limit(MAX_REPORT_ROWS + 1);
  if (rows.length > MAX_REPORT_ROWS) throw reportTooLarge();
  return rows;
}

function mappedReportStudent(row) {
  return {
    studentNo: row.student_no,
    name: `${row.given_name_en} ${row.father_name_en} ${row.grandfather_name_en}`.trim(),
    grade: row.grade_name ?? '', section: row.section_name ?? '',
    gender: row.gender, status: row.status
  };
}

export const mysqlReportsBundle = {
  async getReportFilters(actor) {
    const campus = await this.db('campuses').where({
      id: actor.activeCampusId, organization_id: actor.orgId
    }).first('id');
    if (!campus) throw forbiddenReport();
    const visibleSections = await this.accessibleSectionIds(actor);
    const scope = (query, alias, restrictSections = false) => {
      query.where(`${alias}.campus_id`, actor.activeCampusId)
        .where('c.organization_id', actor.orgId);
      if (restrictSections && visibleSections) {
        if (!visibleSections.size) query.whereRaw('1 = 0');
        else query.whereIn(`${alias}.id`, [...visibleSections]);
      }
    };
    const yearsQuery = this.db('academic_years as y')
      .join('campuses as c', 'c.id', 'y.campus_id')
      .modify((query) => scope(query, 'y'))
      .select('y.id', 'y.label_ec as label').orderBy('y.start_date', 'desc');
    const gradesQuery = this.db('grade_levels as g')
      .join('campuses as c', 'c.id', 'g.campus_id')
      .modify((query) => scope(query, 'g'))
      .select('g.id', 'g.name_en as label').orderBy('g.sort_order');
    const termsQuery = this.db('terms as t').join('academic_years as y', 'y.id', 't.academic_year_id')
      .join('campuses as c', 'c.id', 'y.campus_id')
      .where({ 'y.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId })
      .select('t.id', 't.academic_year_id as yearId', 't.name as label')
      .orderBy('t.start_date');
    if (visibleSections) {
      const sectionIds = [...visibleSections];
      if (!sectionIds.length) {
        yearsQuery.whereRaw('1 = 0');
        gradesQuery.whereRaw('1 = 0');
        termsQuery.whereRaw('1 = 0');
      } else {
        yearsQuery.whereIn('y.id', this.db('sections').whereIn('id', sectionIds).select('academic_year_id'));
        gradesQuery.whereIn('g.id', this.db('sections').whereIn('id', sectionIds).select('grade_level_id'));
        termsQuery.whereIn('t.academic_year_id',
          this.db('sections').whereIn('id', sectionIds).select('academic_year_id'));
      }
    }
    const [years, grades, sections, terms] = await Promise.all([
      boundedRows(yearsQuery),
      boundedRows(gradesQuery),
      boundedRows(this.db('sections as sc').join('campuses as c', 'c.id', 'sc.campus_id')
        .modify((query) => scope(query, 'sc', true))
        .select('sc.id', 'sc.academic_year_id as yearId',
          'sc.grade_level_id as gradeId', 'sc.name as label')
        .orderBy('sc.name')),
      boundedRows(termsQuery)
    ]);
    return { years, terms, grades, sections };
  },
  async getReport(reportId, filters, actor, { exportCsv = false } = {}) {
    const definition = reportCatalog.find((item) => item.id === reportId);
    const permissions = await this.getRolePermissions(actor.orgId, actor.role);
    if (!definition || !definition.roleScope.includes(actor.role) ||
        !permissions.includes(definition.permission)) throw forbiddenReport();

    const campus = await this.db('campuses').where({
      id: actor.activeCampusId, organization_id: actor.orgId
    }).first('id');
    if (!campus) throw forbiddenReport();
    const academicYear = filters.year
      ? await this.db('academic_years').where({
        id: filters.year, campus_id: actor.activeCampusId
      }).first('id', 'start_date', 'end_date', 'status')
      : await this.db('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).first('id', 'start_date', 'end_date', 'status');
    if (filters.year && !academicYear) return reportPage(definition, [], filters.page, filters.pageSize);
    const year = academicYear ? {
      id: academicYear.id,
      startDate: dateOnly(academicYear.start_date),
      endDate: dateOnly(academicYear.end_date)
    } : null;
    const { from, to } = reportDateRange(filters, year, addisDate());
    const visibleSections = await this.accessibleSectionIds(actor);
    const grades = await boundedRows(this.db('grade_levels as g')
      .join('campuses as c', 'c.id', 'g.campus_id')
      .where({ 'g.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId })
      .modify((query) => { if (filters.grade) query.where('g.id', filters.grade); })
      .select('g.id', 'g.name_en'));
    const gradeNames = new Map(grades.map((grade) => [grade.id, grade.name_en]));

    let rows = [];
    if (reportId === 'inventory-stock-valuation') {
      const source = await boundedRows(this.db('inventory_items as i')
        .join('inventory_categories as c', function joinCategory() {
          this.on('c.id', '=', 'i.category_id').andOn('c.organization_id', '=', 'i.organization_id')
            .andOn('c.campus_id', '=', 'i.campus_id');
        }).where({ 'i.organization_id': actor.orgId,
          'i.campus_id': actor.activeCampusId, 'i.status': 'active' })
        .whereNull('i.archived_at').orderBy('i.name')
        .select('i.sku', 'i.name', 'c.name as category', 'i.current_quantity',
          'i.unit', 'i.average_unit_cost_minor', 'i.currency_code', 'i.reorder_level'));
      rows = source.map((row) => {
        const value = BigInt(row.current_quantity) * BigInt(row.average_unit_cost_minor);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('Inventory stock valuation exceeds safe integer precision.');
        }
        return { sku: row.sku, item: row.name, category: row.category,
          quantity: row.current_quantity, unit: row.unit,
          averageUnitCostMinor: Number(row.average_unit_cost_minor),
          stockValueMinor: Number(value), currencyCode: row.currency_code,
          reorderLevel: row.reorder_level };
      });
    } else if (reportId === 'inventory-movements') {
      const source = await boundedRows(this.db('inventory_movements as m')
        .join('inventory_items as i', function joinItem() {
          this.on('i.id', '=', 'm.item_id').andOn('i.organization_id', '=', 'm.organization_id')
            .andOn('i.campus_id', '=', 'm.campus_id');
        }).where({ 'm.organization_id': actor.orgId, 'm.campus_id': actor.activeCampusId })
        .modify((q) => {
          if (from) q.where('m.moved_on', '>=', from);
          if (to) q.where('m.moved_on', '<=', to);
        }).orderBy('m.moved_on', 'desc').select('m.moved_on', 'i.sku',
          'i.name as item', 'm.movement_type', 'm.quantity_delta', 'm.quantity_after',
          'm.unit_cost_minor', 'm.total_cost_minor', 'm.reason'));
      rows = source.map((row) => ({ date: dateOnly(row.moved_on), sku: row.sku,
        item: row.item, movementType: row.movement_type, quantityDelta: row.quantity_delta,
        quantityAfter: row.quantity_after, unitCostMinor: Number(row.unit_cost_minor),
        totalCostMinor: Number(row.total_cost_minor), reason: row.reason }));
    } else if (reportId === 'inventory-assets') {
      const source = await boundedRows(this.db('fixed_assets as a')
        .leftJoin('asset_allocations as l', function joinAllocation() {
          this.on('l.asset_id', '=', 'a.id').andOn('l.organization_id', '=', 'a.organization_id')
            .andOn('l.campus_id', '=', 'a.campus_id').andOnVal('l.status', '=', 'active');
        }).leftJoin('staff as s', function joinStaff() {
          this.on('s.id', '=', 'l.staff_id').andOn('s.organization_id', '=', 'l.organization_id')
            .andOn('s.campus_id', '=', 'l.campus_id');
        }).leftJoin('rooms as r', function joinRoom() {
          this.on('r.id', '=', 'l.room_id').andOn('r.campus_id', '=', 'l.campus_id');
        }).where({ 'a.organization_id': actor.orgId, 'a.campus_id': actor.activeCampusId })
        .whereNull('a.archived_at').orderBy('a.asset_tag').select(
          'a.asset_tag', 'a.name', 'a.category', 'a.purchased_on', 'a.purchase_cost_minor',
          'a.currency_code', 'a.condition', 'a.location', 'a.status',
          this.db.raw("COALESCE(TRIM(CONCAT(s.given_name_en, ' ', s.father_name_en, ' ', s.grandfather_name_en)), r.name, '') as allocated_to")
        ));
      rows = source.map((row) => ({ assetTag: row.asset_tag, name: row.name,
        category: row.category, purchasedOn: dateOnly(row.purchased_on),
        purchaseCostMinor: Number(row.purchase_cost_minor), currencyCode: row.currency_code,
        condition: row.condition, location: row.location, status: row.status,
        allocatedTo: row.allocated_to }));
    } else if (reportId === 'front-desk-visitors') {
      const source = await boundedRows(this.db('frontdesk_visitors as v')
        .join('campuses as c', 'c.id', 'v.campus_id')
        .where({ 'v.organization_id': actor.orgId, 'v.campus_id': actor.activeCampusId,
          'c.organization_id': actor.orgId }).whereNull('v.archived_at')
        .modify((q) => {
          if (from) q.where('v.checked_in_at', '>=', from);
          if (to) q.where('v.checked_in_at', '<=', `${to} 23:59:59`);
        }).orderBy('v.checked_in_at', 'desc').select('v.visitor_name', 'v.purpose',
          'v.host_staff_id', 'v.checked_in_at', 'v.checked_out_at', 'v.status'));
      rows = source.map((row) => ({ visitorName: row.visitor_name, purpose: row.purpose,
        hostStaffId: row.host_staff_id, checkedInAt: dateTime(row.checked_in_at),
        checkedOutAt: dateTime(row.checked_out_at), status: row.status }));
    } else if (reportId === 'front-desk-appointments') {
      const source = await boundedRows(this.db('frontdesk_appointments as a')
        .join('campuses as c', 'c.id', 'a.campus_id')
        .where({ 'a.organization_id': actor.orgId, 'a.campus_id': actor.activeCampusId,
          'c.organization_id': actor.orgId }).whereNull('a.archived_at')
        .modify((q) => {
          if (from) q.where('a.appointment_at', '>=', from);
          if (to) q.where('a.appointment_at', '<=', `${to} 23:59:59`);
        }).orderBy('a.appointment_at').select('a.parent_name', 'a.student_id', 'a.staff_id',
          'a.appointment_at', 'a.purpose', 'a.status'));
      rows = source.map((row) => ({ parentName: row.parent_name, studentId: row.student_id,
        staffId: row.staff_id, appointmentAt: dateTime(row.appointment_at),
        purpose: row.purpose, status: row.status }));
    } else if (reportId === 'front-desk-pickups') {
      const source = await boundedRows(this.db('frontdesk_pickup_events as e')
        .join('campuses as c', 'c.id', 'e.campus_id')
        .where({ 'e.organization_id': actor.orgId, 'e.campus_id': actor.activeCampusId,
          'c.organization_id': actor.orgId })
        .modify((q) => {
          if (from) q.where('e.released_at', '>=', from);
          if (to) q.where('e.released_at', '<=', `${to} 23:59:59`);
        }).orderBy('e.released_at', 'desc').select('e.student_id', 'e.picked_up_by',
          'e.released_by', 'e.released_at', 'e.event_type', 'e.note', 'e.correction_reason'));
      rows = source.map((row) => ({ studentId: row.student_id, pickedUpBy: row.picked_up_by,
        releasedBy: row.released_by, releasedAt: dateTime(row.released_at),
        eventType: row.event_type, note: row.note, correctionReason: row.correction_reason }));
    } else if (reportId === 'library-inventory') {
      const result = await boundedRows(this.db('library_books as b')
        .leftJoin('library_categories as cat', function joinCategory() {
          this.on('cat.id', '=', 'b.category_id')
            .andOn('cat.organization_id', '=', 'b.organization_id')
            .andOn('cat.campus_id', '=', 'b.campus_id');
        })
        .leftJoin('library_copies as cp', function joinCopy() {
          this.on('cp.book_id', '=', 'b.id')
            .andOn('cp.organization_id', '=', 'b.organization_id')
            .andOn('cp.campus_id', '=', 'b.campus_id')
            .andOnNull('cp.archived_at');
        })
        .where({ 'b.organization_id': actor.orgId, 'b.campus_id': actor.activeCampusId,
          'b.status': 'active' }).whereNull('b.archived_at')
        .groupBy('b.id', 'b.title', 'b.author', 'b.isbn', 'cat.name')
        .orderBy('b.title').select('b.title', 'b.author', 'b.isbn', 'cat.name as category',
          this.db.raw('COUNT(cp.id) as total_copies'),
          this.db.raw('SUM(CASE WHEN cp.status = "available" THEN 1 ELSE 0 END) as available_copies'),
          this.db.raw('SUM(CASE WHEN cp.status = "loaned" THEN 1 ELSE 0 END) as borrowed_copies'),
          this.db.raw('SUM(CASE WHEN cp.status = "reserved" THEN 1 ELSE 0 END) as reserved_copies'),
          this.db.raw('SUM(CASE WHEN cp.status IN ("damaged", "lost") THEN 1 ELSE 0 END) as unavailable_copies')));
      rows = result.map((row) => ({
        title: row.title, author: row.author, isbn: row.isbn ?? '', category: row.category ?? '',
        totalCopies: Number(row.total_copies), availableCopies: Number(row.available_copies),
        borrowedCopies: Number(row.borrowed_copies), reservedCopies: Number(row.reserved_copies),
        unavailableCopies: Number(row.unavailable_copies)
      }));
    } else if (reportId === 'library-copies') {
      rows = await boundedRows(this.db('library_copies as cp')
        .join('library_books as b', function joinBook() {
          this.on('b.id', '=', 'cp.book_id').andOn('b.organization_id', '=', 'cp.organization_id')
            .andOn('b.campus_id', '=', 'cp.campus_id');
        }).where({
          'cp.organization_id': actor.orgId, 'cp.campus_id': actor.activeCampusId
        }).whereNull('cp.archived_at').whereNull('b.archived_at')
        .orderBy('b.title').orderBy('cp.copy_number')
        .select('cp.barcode', 'cp.copy_number', 'b.title', 'b.author', 'cp.condition',
          'cp.shelf_location', 'cp.status'))
        .then((result) => result.map((row) => ({
          barcode: row.barcode, copyNumber: row.copy_number, title: row.title,
          author: row.author, condition: row.condition, shelfLocation: row.shelf_location,
          status: row.status
        })));
    } else if (reportId === 'library-circulation') {
      const result = await boundedRows(this.db('library_loans as l')
        .join('library_books as b', function joinBook() {
          this.on('b.id', '=', 'l.book_id').andOn('b.organization_id', '=', 'l.organization_id')
            .andOn('b.campus_id', '=', 'l.campus_id');
        }).join('library_members as m', function joinMember() {
          this.on('m.id', '=', 'l.member_id').andOn('m.organization_id', '=', 'l.organization_id')
            .andOn('m.campus_id', '=', 'l.campus_id');
        }).leftJoin('students as s', function joinStudent() {
          this.on('s.id', '=', 'm.student_id').andOn('s.campus_id', '=', 'm.campus_id');
        }).leftJoin('staff as st', function joinStaff() {
          this.on('st.id', '=', 'm.staff_id').andOn('st.organization_id', '=', 'm.organization_id')
            .andOn('st.campus_id', '=', 'm.campus_id');
        })
        .leftJoin('library_fines as f', function joinFine() {
          this.on('f.loan_id', '=', 'l.id').andOn('f.organization_id', '=', 'l.organization_id')
            .andOn('f.campus_id', '=', 'l.campus_id');
        }).where({ 'l.organization_id': actor.orgId, 'l.campus_id': actor.activeCampusId })
        .modify((builder) => {
          if (from) builder.where('l.issued_on', '>=', from);
          if (to) builder.where('l.issued_on', '<=', to);
        }).orderBy('l.issued_on', 'desc').select(
          'l.issued_on', 'l.due_on', 'l.returned_on', 'b.title', 'l.status',
          'f.amount_minor', 'f.currency_code',
          this.db.raw("COALESCE(TRIM(CONCAT(s.given_name_en, ' ', s.father_name_en, ' ', s.grandfather_name_en)), TRIM(CONCAT(st.given_name_en, ' ', st.father_name_en, ' ', st.grandfather_name_en))) as member")
        ));
      rows = result.map((row) => ({
        issuedOn: dateOnly(row.issued_on), dueOn: dateOnly(row.due_on),
        returnedOn: row.returned_on ? dateOnly(row.returned_on) : '',
        title: row.title, member: row.member, status: row.status,
        fineMinor: Number(row.amount_minor ?? 0), currencyCode: row.currency_code ?? ''
      }));
    } else if (reportId === 'hr-employees') {
      const records = await boundedRows(this.db('staff as st')
        .join('campuses as c', 'c.id', 'st.campus_id')
        .where({
          'st.organization_id': actor.orgId, 'st.campus_id': actor.activeCampusId,
          'c.organization_id': actor.orgId
        }).whereNull('st.archived_at')
        .whereBetween('st.hired_on', [from, to])
        .select('st.employment_status as status'));
      const counts = new Map();
      for (const { status } of records) counts.set(status, (counts.get(status) ?? 0) + 1);
      rows = [...counts].map(([status, count]) => ({ status, count }));
    } else if (reportId === 'hr-leave') {
      rows = await boundedRows(this.db('leave_requests as lr')
        .join('staff as st', 'st.id', 'lr.staff_id')
        .join('campuses as c', 'c.id', 'lr.campus_id')
        .leftJoin('hr_leave_types as lt', 'lt.id', 'lr.leave_type_id')
        .where({
          'lr.organization_id': actor.orgId, 'lr.campus_id': actor.activeCampusId,
          'st.organization_id': actor.orgId, 'st.campus_id': actor.activeCampusId,
          'c.organization_id': actor.orgId
        }).where('lr.start_date', '<=', to).where('lr.end_date', '>=', from)
        .select(this.db.raw("TRIM(CONCAT(st.given_name_en, ' ', st.father_name_en, ' ', st.grandfather_name_en)) as staff"),
          'lt.name as leave_type', 'lr.status', 'lr.start_date', 'lr.end_date',
          'lr.requested_half_days as half_days')).then((records) => records.map((row) => ({
        staff: row.staff, leaveType: row.leave_type ?? 'Unpaid', status: row.status,
        startDate: dateOnly(row.start_date), endDate: dateOnly(row.end_date),
        halfDays: row.half_days ?? 0
      })));
    } else if (reportId === 'hr-staff-attendance') {
      rows = await boundedRows(this.db('staff_attendance as sa')
        .join('staff as st', 'st.id', 'sa.staff_id')
        .join('campuses as c', 'c.id', 'sa.campus_id')
        .leftJoin('departments as d', 'd.id', 'st.department_id')
        .where({
          'st.organization_id': actor.orgId, 'sa.campus_id': actor.activeCampusId,
          'st.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId
        }).whereBetween('sa.attendance_date', [from, to])
        .select(this.db.raw("TRIM(CONCAT(st.given_name_en, ' ', st.father_name_en, ' ', st.grandfather_name_en)) as staff"),
          'd.name as department', 'sa.attendance_date', 'sa.status', 'sa.clock_in', 'sa.clock_out'))
        .then((records) => records.map((row) => ({
          staff: row.staff, department: row.department ?? '',
          date: dateOnly(row.attendance_date), status: row.status,
          clockIn: row.clock_in ?? '', clockOut: row.clock_out ?? ''
        })));
    } else if (reportId === 'student-directory') {
      const query = this.db('students as st')
        .join('campuses as c', 'c.id', 'st.campus_id')
        .join('enrolments as e', function joinEnrollment() {
          this.on('e.student_id', '=', 'st.id');
        })
        .leftJoin('sections as sc', 'sc.id', 'e.section_id')
        .leftJoin('grade_levels as g', 'g.id', 'sc.grade_level_id')
        .where({
          'st.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId
        }).whereNull('st.archived_at')
        .modify((builder) => {
          builder.where('e.status', 'active');
          if (year) builder.where('e.academic_year_id', year.id);
          builder.whereBetween('e.enrolled_on', [from, to]);
          if (filters.grade) builder.where('g.id', filters.grade);
          if (filters.section) builder.where('sc.id', filters.section);
          if (visibleSections) {
            if (!visibleSections.size) builder.whereRaw('1 = 0');
            else builder.whereIn('sc.id', [...visibleSections]);
          }
        })
        .select('st.student_no', 'st.given_name_en', 'st.father_name_en',
          'st.grandfather_name_en', 'st.gender', 'st.status',
          'sc.name as section_name', 'g.name_en as grade_name')
        .orderBy('st.student_no');
      rows = (await boundedRows(query)).map(mappedReportStudent);
    } else if (reportId === 'admissions-enrolment') {
      const gradesById = new Map(grades.map((grade) => [grade.id, {
        id: grade.id, name: grade.name_en
      }]));
      const [admissions, sectionRows, enrolments] = await Promise.all([
        boundedRows(this.db('admissions as a').join('campuses as c', 'c.id', 'a.campus_id')
          .where({
            'a.organization_id': actor.orgId, 'a.campus_id': actor.activeCampusId,
            'c.organization_id': actor.orgId
          }).whereBetween('a.created_at', [from, to]).modify((query) => {
            if (year) query.where('a.academic_year_id', year.id);
            if (filters.grade) query.where('a.grade_level_id', filters.grade);
          }).select('a.grade_level_id as gradeLevelId', 'a.status')),
        boundedRows(this.db('sections as sc').join('campuses as c', 'c.id', 'sc.campus_id')
          .where({
            'sc.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId
          }).modify((query) => {
            if (year) query.where('sc.academic_year_id', year.id);
            if (filters.grade) query.where('sc.grade_level_id', filters.grade);
          }).select('sc.id', 'sc.grade_level_id as gradeLevelId', 'sc.capacity')),
        year ? boundedRows(this.db('enrolments as e')
          .join('sections as sc', 'sc.id', 'e.section_id')
          .join('campuses as c', 'c.id', 'sc.campus_id')
          .where({
            'sc.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId,
            'e.academic_year_id': year.id, 'e.status': 'active'
          }).modify((query) => {
            if (filters.grade) query.where('sc.grade_level_id', filters.grade);
          }).select('e.section_id as sectionId', 'e.status')) : []
      ]);
      rows = aggregateReportRows(reportId, {
        grades: [...gradesById.values()], admissions,
        sections: sectionRows.map((row) => ({
          id: row.id, gradeLevelId: row.gradeLevelId,
          capacity: row.capacity == null ? null : Number(row.capacity)
        })),
        enrolments
      });
    } else if (reportId.startsWith('attendance-')) {
      let term = null;
      if (filters.term) {
        term = await this.db('terms as t').join('academic_years as y', 'y.id', 't.academic_year_id')
          .where({
            't.id': filters.term, 'y.campus_id': actor.activeCampusId,
            ...(year ? { 'y.id': year.id } : {})
          }).first('t.start_date', 't.end_date');
        if (!term) return reportPage(definition, [], filters.page, filters.pageSize);
      }
      const query = this.db('attendance_sessions as ats')
        .join('campuses as c', 'c.id', 'ats.campus_id')
        .join('sections as sc', 'sc.id', 'ats.section_id')
        .join('grade_levels as g', 'g.id', 'sc.grade_level_id')
        .join('attendance_records as ar', 'ar.session_id', 'ats.id')
        .join('students as st', 'st.id', 'ar.student_id')
        .where({
          'ats.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId,
          'st.campus_id': actor.activeCampusId
        }).whereBetween('ats.attendance_date', [from, to])
        .modify((builder) => {
          if (year) builder.where('sc.academic_year_id', year.id);
          if (filters.grade) builder.where('g.id', filters.grade);
          if (filters.section) builder.where('sc.id', filters.section);
          if (term) builder.whereBetween('ats.attendance_date', [
            dateOnly(term.start_date), dateOnly(term.end_date)
          ]);
          if (visibleSections) {
            if (!visibleSections.size) builder.whereRaw('1 = 0');
            else builder.whereIn('sc.id', [...visibleSections]);
          }
        }).select(
          this.db.raw('DATE_FORMAT(ats.attendance_date, "%Y-%m-%d") as date'),
          'sc.id as sectionId', 'sc.name as section',
          'g.name_en as grade', 'st.id as studentId', 'st.student_no as studentNo',
          this.db.raw("TRIM(CONCAT(st.given_name_en, ' ', st.father_name_en, ' ', st.grandfather_name_en)) as name"),
          'ar.status'
        ).orderBy('ats.attendance_date').orderBy('sc.name');
      rows = aggregateReportRows(reportId, await boundedRows(query));
    } else if (['academic-pass-rates', 'subject-performance', 'class-comparison',
      'student-progress'].includes(reportId)) {
      const query = this.db('marks as m')
        .join('campuses as c', 'c.id', 'm.campus_id')
        .join('students as st', 'st.id', 'm.student_id')
        .join('terms as t', 't.id', 'm.term_id')
        .join('academic_years as y', 'y.id', 't.academic_year_id')
        .join('enrolments as e', function joinEnrollment() {
          this.on('e.student_id', '=', 'st.id').andOn('e.academic_year_id', '=', 'y.id');
        })
        .join('sections as sc', 'sc.id', 'e.section_id')
        .join('grade_levels as g', 'g.id', 'sc.grade_level_id')
        .join('subjects as su', 'su.id', 'm.subject_id')
        .where({
          'm.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId,
          'st.campus_id': actor.activeCampusId, 'y.campus_id': actor.activeCampusId,
          'sc.campus_id': actor.activeCampusId, 'su.campus_id': actor.activeCampusId,
          'm.state': 'locked'
        }).whereBetween('t.start_date', [from, to])
        .where('e.status', 'active')
        .modify((builder) => {
          if (year) builder.where('y.id', year.id);
          if (filters.term) builder.where('m.term_id', filters.term);
          if (filters.grade) builder.where('g.id', filters.grade);
          if (filters.section) builder.where('sc.id', filters.section);
          if (visibleSections) {
            if (!visibleSections.size) builder.whereRaw('1 = 0');
            else builder.whereIn('sc.id', [...visibleSections]);
          }
        }).select(
          'st.id as studentId', 'st.student_no as studentNo',
          this.db.raw("TRIM(CONCAT(st.given_name_en, ' ', st.father_name_en, ' ', st.grandfather_name_en)) as name"),
          'g.name_en as grade', 'sc.name as section', 't.name as term',
          'su.name_en as subject', 'm.value', 'm.max_value as maxValue'
        ).orderBy('t.start_date').orderBy('st.student_no');
      const source = (await boundedRows(query)).map((row) => ({
        ...row, value: Number(row.value), maxValue: Number(row.maxValue),
        score: Number(row.maxValue) ? Math.round((Number(row.value) / Number(row.maxValue)) * 10000) / 100 : 0
      }));
      rows = reportId === 'student-progress' ? source : aggregateReportRows(reportId, source);
    } else if (reportId === 'finance-collection') {
      const source = await this.getFeeReport('details', from, to, actor);
      const sectionNames = filters.grade || filters.section
        ? new Set((await boundedRows(this.db('sections as sc').join('campuses as c', 'c.id', 'sc.campus_id')
          .where({ 'sc.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId })
          .modify((query) => {
            if (year) query.where('sc.academic_year_id', year.id);
            if (filters.grade) query.where('sc.grade_level_id', filters.grade);
            if (filters.section) query.where('sc.id', filters.section);
          }).select('sc.name'))).map((item) => item.name))
        : null;
      rows = aggregateReportRows(reportId, source.filter((item) =>
        !sectionNames || sectionNames.has(item.className)));
    } else if (reportId === 'finance-arrears') {
      const source = await this.getArrearsReport(to, actor);
      const sectionRows = filters.grade || filters.section
        ? await boundedRows(this.db('sections as sc').join('campuses as c', 'c.id', 'sc.campus_id')
          .where({ 'sc.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId })
          .modify((query) => {
            if (year) query.where('sc.academic_year_id', year.id);
            if (filters.grade) query.where('sc.grade_level_id', filters.grade);
            if (filters.section) query.where('sc.id', filters.section);
          }).select('sc.id', 'sc.name', 'sc.grade_level_id'))
        : null;
      const sectionIds = sectionRows ? new Set(sectionRows.map((item) => item.id)) : null;
      const sectionNames = sectionRows ? new Map(sectionRows.map((item) =>
        [item.id, { name: item.name, grade: gradeNames.get(item.grade_level_id) ?? '' }])) : null;
      rows = aggregateReportRows(reportId, source.filter((item) =>
        !sectionIds || sectionIds.has(item.sectionId)).map((item) => ({
        ...item, sectionName: sectionNames?.get(item.sectionId)?.name ?? item.sectionName,
        grade: sectionNames?.get(item.sectionId)?.grade ?? ''
      })));
    } else if (['my-classes', 'syllabus-coverage', 'teacher-workload'].includes(reportId)) {
      const assignmentQuery = this.db('teaching_assignments as ta')
        .join('campuses as c', 'c.id', 'ta.campus_id')
        .join('staff as st', 'st.id', 'ta.staff_id')
        .join('sections as sc', 'sc.id', 'ta.section_id')
        .join('academic_years as ay', 'ay.id', 'sc.academic_year_id')
        .join('grade_levels as g', 'g.id', 'sc.grade_level_id')
        .join('subjects as su', 'su.id', 'ta.subject_id')
        .where({
          'ta.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId,
          'ta.is_active': true
        }).whereNull('st.archived_at')
        .modify((query) => {
          if (year) query.where('ay.id', year.id);
          if (filters.grade) query.where('g.id', filters.grade);
          if (filters.section) query.where('sc.id', filters.section);
          if (visibleSections) {
            if (!visibleSections.size) query.whereRaw('1 = 0');
            else query.whereIn('sc.id', [...visibleSections]);
          }
          if (['homeroom_teacher', 'subject_teacher'].includes(actor.role)) {
            query.where('st.user_id', actor.sub);
          }
        }).select(
          'ta.id', 'ta.staff_id as staffId', 'ta.section_id as sectionId',
          'ta.subject_id as subjectId', 'ta.period_number as periodNumber',
          'sc.stream', 'sc.academic_year_id as academicYearId',
          'g.id as gradeId', 'g.name_en as grade', 'sc.name as section', 'su.name_en as subject',
          this.db.raw("TRIM(CONCAT(st.given_name_en, ' ', st.father_name_en, ' ', st.grandfather_name_en)) as staffName"),
          'ay.label_ec as academicYear'
        ).orderBy('g.sort_order').orderBy('sc.name').orderBy('su.name_en');
      const assignments = await boundedRows(assignmentQuery);
      if (reportId === 'my-classes') {
        rows = assignments.map(({ grade, section, subject, academicYear }) => ({
          grade, section, subject, academicYear
        }));
      } else if (reportId === 'teacher-workload') {
        rows = aggregateTeacherWorkload(assignments, filters.workloadLimit ?? 25);
      } else if (assignments.length) {
        const assignmentIds = assignments.map((item) => item.id);
        const [units, completedPlans] = await Promise.all([
          boundedRows(this.db('curriculum_units as cu')
            .join('campuses as c', 'c.id', 'cu.campus_id')
            .where({
              'cu.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId
            }).modify((query) => {
              if (year) query.where('cu.academic_year_id', year.id);
              if (filters.grade) query.where('cu.grade_level_id', filters.grade);
            }).select('cu.id', 'cu.academic_year_id as academicYearId',
              'cu.grade_level_id as gradeId', 'cu.subject_id as subjectId', 'cu.stream')),
          boundedRows(this.db('lesson_plans as lp')
            .join('campuses as c', 'c.id', 'lp.campus_id')
            .where({
              'lp.campus_id': actor.activeCampusId, 'c.organization_id': actor.orgId,
              'lp.status': 'completed'
            }).whereNotNull('lp.curriculum_unit_id')
            .whereBetween('lp.planned_on', [from, to])
            .whereIn('lp.teaching_assignment_id', assignmentIds)
            .select('lp.teaching_assignment_id as assignmentId',
              'lp.curriculum_unit_id as unitId'))
        ]);
        const groups = new Map();
        for (const assignment of assignments) {
          const key = `${assignment.sectionId}:${assignment.subjectId}`;
          const group = groups.get(key) ?? { assignment, assignmentIds: new Set() };
          group.assignmentIds.add(assignment.id);
          groups.set(key, group);
        }
        rows = [...groups.values()].map(({ assignment, assignmentIds: groupAssignmentIds }) => {
          const groupUnits = units.filter((unit) =>
            unit.academicYearId === assignment.academicYearId &&
            unit.gradeId === assignment.gradeId &&
            unit.subjectId === assignment.subjectId &&
            (unit.stream === 'all' || unit.stream === (assignment.stream ?? 'all')));
          const groupUnitIds = new Set(groupUnits.map((unit) => unit.id));
          const coveredIds = new Set(completedPlans.filter((plan) =>
            groupAssignmentIds.has(plan.assignmentId) && groupUnitIds.has(plan.unitId))
            .map((plan) => plan.unitId));
          return {
            grade: assignment.grade, section: assignment.section, subject: assignment.subject,
            units: groupUnits.length, coveredUnits: coveredIds.size,
            coveragePercent: syllabusCoveragePercent(coveredIds.size, groupUnits.length)
          };
        });
      }
    } else if (['payroll-monthly', 'payroll-department-expense', 'payroll-deductions']
      .includes(reportId)) {
      const sourceQuery = this.db('payroll_runs as r')
        .join('payroll_periods as p', function joinPeriod() {
          this.on('p.id', '=', 'r.period_id')
            .andOn('p.organization_id', '=', 'r.organization_id')
            .andOn('p.campus_id', '=', 'r.campus_id');
        }).join('payroll_lines as l', function joinLine() {
          this.on('l.run_id', '=', 'r.id')
            .andOn('l.organization_id', '=', 'r.organization_id')
            .andOn('l.campus_id', '=', 'r.campus_id');
        }).join('campuses as c', 'c.id', 'r.campus_id')
        .where({
          'r.organization_id': actor.orgId, 'r.campus_id': actor.activeCampusId,
          'p.organization_id': actor.orgId, 'p.campus_id': actor.activeCampusId,
          'l.organization_id': actor.orgId, 'l.campus_id': actor.activeCampusId,
          'c.organization_id': actor.orgId
        }).whereIn('r.status', ['locked', 'closed'])
        .where('p.starts_on', '<=', to).where('p.ends_on', '>=', from)
        .modify((query) => {
          if (reportId === 'payroll-department-expense') {
            query.leftJoin('staff as st', function joinStaff() {
              this.on('st.id', '=', 'l.staff_id')
                .andOn('st.organization_id', '=', 'l.organization_id')
                .andOn('st.campus_id', '=', 'l.campus_id');
            }).leftJoin('departments as d', function joinDepartment() {
              this.on('d.id', '=', 'st.department_id')
                .andOn('d.campus_id', '=', 'st.campus_id');
            });
          }
        });
      let source;
      if (reportId === 'payroll-monthly') {
        source = await boundedRows(sourceQuery.select(
          'r.id as run_id', 'r.status', 'p.code as period', 'p.currency_code',
          'l.gross_minor', 'l.net_minor'
        ).orderBy('p.starts_on', 'desc'));
        const grouped = new Map();
        for (const item of source) {
          const row = grouped.get(item.run_id) ?? {
            period: item.period, status: item.status, currencyCode: item.currency_code,
            staffCount: 0, grossMinor: 0, netMinor: 0
          };
          row.staffCount++;
          row.grossMinor += Number(item.gross_minor);
          row.netMinor += Number(item.net_minor);
          grouped.set(item.run_id, row);
        }
        rows = [...grouped.values()];
      } else if (reportId === 'payroll-department-expense') {
        source = await boundedRows(sourceQuery.select(
          'd.id as department_id', 'd.name as department', 'l.currency_code',
          'l.staff_id', 'l.gross_minor'
        ));
        const grouped = new Map();
        for (const item of source) {
          const key = `${item.department_id ?? 'unassigned'}:${item.currency_code}`;
          const row = grouped.get(key) ?? {
            department: item.department ?? 'Unassigned',
            currencyCode: item.currency_code, staffCount: 0, grossMinor: 0,
            staffIds: new Set()
          };
          row.staffIds.add(item.staff_id);
          row.grossMinor += Number(item.gross_minor);
          grouped.set(key, row);
        }
        rows = [...grouped.values()].map(({ staffIds, ...item }) => ({
          ...item, staffCount: staffIds.size
        }));
      } else {
        source = await boundedRows(sourceQuery.select(
          'l.currency_code', 'l.unpaid_leave_deduction_minor', 'l.tax_minor',
          'l.pension_minor', 'l.other_deductions_minor'
        ));
        const grouped = new Map();
        for (const item of source) {
          for (const [deductionType, amount] of [
            ['unpaid_leave', item.unpaid_leave_deduction_minor],
            ['tax', item.tax_minor], ['pension', item.pension_minor],
            ['other', item.other_deductions_minor]
          ]) {
            const key = `${deductionType}:${item.currency_code}`;
            const row = grouped.get(key) ?? {
              deductionType, currencyCode: item.currency_code, amountMinor: 0
            };
            row.amountMinor += Number(amount);
            grouped.set(key, row);
          }
        }
        rows = [...grouped.values()];
      }
    }

    if (rows.length > MAX_REPORT_ROWS) throw reportTooLarge();
    const result = reportPage(definition, rows,
      exportCsv ? 1 : filters.page, exportCsv ? Math.max(rows.length, 1) : filters.pageSize, exportCsv);
    result.summary = summarizeReport(reportId, rows);
    if (exportCsv) {
      await this.appendAudit(actor, 'report.exported', 'report', reportId, null, {
        filters, rowCount: rows.length
      });
    }
    return result;
  }
};
