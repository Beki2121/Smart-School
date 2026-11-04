import { randomUUID } from 'node:crypto';
import { auditRow } from '../shared.js';

function inventoryError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function duplicate(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

function integer(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw inventoryError('INVENTORY_VALUE_OVERFLOW', `${label} exceeds supported integer precision.`, 400);
  }
  return number;
}

function averageCost(quantity, average, addQuantity, unitCost) {
  if (!quantity) return unitCost;
  const total = BigInt(quantity) + BigInt(addQuantity);
  const weighted = BigInt(quantity) * BigInt(average) +
    BigInt(addQuantity) * BigInt(unitCost);
  return integer((weighted + total / 2n) / total, 'Average cost');
}

function mapCategory(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    name: row.name, status: row.status, archivedAt: row.archived_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapSupplier(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    name: row.name, contactName: row.contact_name, email: row.email, phone: row.phone,
    address: row.address, status: row.status, archivedAt: row.archived_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapItem(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    categoryId: row.category_id, sku: row.sku, name: row.name, unit: row.unit,
    reorderLevel: row.reorder_level, currentQuantity: row.current_quantity,
    averageUnitCostMinor: integer(row.average_unit_cost_minor, 'Average unit cost'),
    currencyCode: row.currency_code, status: row.status, archivedAt: row.archived_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.low_stock !== undefined ? { lowStock: Boolean(row.low_stock) } : {}) };
}
function mapPurchase(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    purchaseNumber: row.purchase_number, supplierId: row.supplier_id,
    purchasedOn: dateOnly(row.purchased_on), expectedOn: row.expected_on ? dateOnly(row.expected_on) : null,
    currencyCode: row.currency_code, status: row.status, notes: row.notes,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapPurchaseLine(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    purchaseId: row.purchase_id, lineNumber: row.line_number, itemId: row.item_id, quantity: row.quantity,
    receivedQuantity: row.received_quantity,
    unitCostMinor: integer(row.unit_cost_minor, 'Purchase unit cost'),
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapMovement(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    itemId: row.item_id, movementType: row.movement_type, quantityDelta: row.quantity_delta,
    quantityAfter: row.quantity_after, unitCostMinor: integer(row.unit_cost_minor, 'Movement unit cost'),
    totalCostMinor: integer(row.total_cost_minor, 'Movement value'), currencyCode: row.currency_code,
    purchaseId: row.purchase_id, receiptId: row.receipt_id,
    idempotencyKey: row.idempotency_key, movedOn: dateOnly(row.moved_on),
    reason: row.reason, createdBy: row.created_by, createdAt: row.created_at };
}
function mapAsset(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    assetTag: row.asset_tag, category: row.category, name: row.name,
    purchasedOn: dateOnly(row.purchased_on), purchaseCostMinor: integer(row.purchase_cost_minor, 'Asset cost'),
    currencyCode: row.currency_code, condition: row.condition, location: row.location,
    status: row.status, activeAllocationId: row.active_allocation_id, notes: row.notes,
    disposedAt: row.disposed_at, lostAt: row.lost_at, archivedAt: row.archived_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapAllocation(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    assetId: row.asset_id, activeAssetId: row.active_asset_id, staffId: row.staff_id,
    roomId: row.room_id, allocatedOn: dateOnly(row.allocated_on),
    returnedOn: row.returned_on ? dateOnly(row.returned_on) : null,
    status: row.status, allocatedBy: row.allocated_by, returnedBy: row.returned_by,
    notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at };
}
function dateOnly(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}
async function audit(trx, actor, action, entity, id, before, after) {
  await trx('audit_log').insert(auditRow(actor, `inventory.${action}`, entity, id, before, after));
}
async function notifyLowStock(trx, actor, item, movementId) {
  if (item.current_quantity > item.reorder_level) return;
  const recipients = await trx('users as u')
    .join('user_campuses as uc', 'uc.user_id', 'u.id')
    .where({ 'u.organization_id': actor.orgId, 'uc.campus_id': actor.activeCampusId,
      'uc.is_active': true, 'u.is_active': true })
    .whereIn('u.role', ['store_keeper', 'owner_director', 'principal', 'system_admin'])
    .distinct('u.id');
  if (!recipients.length) return;
  await trx('user_notifications').insert(recipients.map((recipient) => ({
    id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
    user_id: recipient.id, source_type: 'inventory_low_stock', source_id: movementId,
    title_en: 'Low inventory stock', title_am: 'Low inventory stock',
    body_en: `${item.name} is at or below its reorder level (${item.current_quantity} ${item.unit}).`,
    body_am: `${item.name} is at or below its reorder level (${item.current_quantity} ${item.unit}).`
  }))).onConflict(['user_id', 'source_type', 'source_id']).ignore();
}

export const mysqlInventoryBundle = {
  async listInventoryCategories(actor) {
    return (await this.db('inventory_categories').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').orderBy('name')).map(mapCategory);
  },
  async createInventoryCategory(data, actor) {
    const row = { id: randomUUID(), organization_id: actor.orgId,
      campus_id: actor.activeCampusId, ...data, status: 'active' };
    try {
      await this.db.transaction(async (trx) => {
        await trx('inventory_categories').insert(row);
        await audit(trx, actor, 'category_created', 'inventory_category', row.id, null, data);
      });
    } catch (error) {
      if (duplicate(error)) throw inventoryError('INVENTORY_CATEGORY_DUPLICATE', 'Category name already exists.');
      throw error;
    }
    return mapCategory(await this.db('inventory_categories').where({ id: row.id,
      organization_id: actor.orgId, campus_id: actor.activeCampusId }).first());
  },
  async listInventorySuppliers(query, actor) {
    const builder = this.db('inventory_suppliers').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).modify((q) => {
      if (query.status === 'archived') q.whereNotNull('archived_at');
      else q.whereNull('archived_at');
      if (query.status && query.status !== 'archived') q.where('status', query.status);
      if (query.search) q.where((search) => search.where('name', 'like', `%${query.search}%`)
        .orWhere('contact_name', 'like', `%${query.search}%`));
    }).orderBy('name').limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return (await builder).map(mapSupplier);
  },
  async createInventorySupplier(data, actor) {
    const row = { id: randomUUID(), organization_id: actor.orgId,
      campus_id: actor.activeCampusId, name: data.name, contact_name: data.contactName,
      email: data.email, phone: data.phone, address: data.address, status: 'active' };
    try {
      await this.db.transaction(async (trx) => {
        await trx('inventory_suppliers').insert(row);
        await audit(trx, actor, 'supplier_created', 'inventory_supplier', row.id, null, data);
      });
    } catch (error) {
      if (duplicate(error)) throw inventoryError('INVENTORY_SUPPLIER_DUPLICATE', 'Supplier already exists.');
      throw error;
    }
    return mapSupplier(await this.db('inventory_suppliers').where({ id: row.id,
      organization_id: actor.orgId, campus_id: actor.activeCampusId }).first());
  },
  async listInventoryItems(query, actor) {
    const rows = await this.db('inventory_items as i').where({
      'i.organization_id': actor.orgId, 'i.campus_id': actor.activeCampusId
    }).leftJoin('inventory_categories as c', function joinCategory() {
      this.on('c.id', '=', 'i.category_id').andOn('c.organization_id', '=', 'i.organization_id')
        .andOn('c.campus_id', '=', 'i.campus_id');
    }).modify((q) => {
      if (query.status === 'archived') q.whereNotNull('i.archived_at');
      else q.whereNull('i.archived_at');
      if (query.status && query.status !== 'archived') q.where('i.status', query.status);
      if (query.categoryId) q.where('i.category_id', query.categoryId);
      if (query.search) q.where((search) => search.where('i.sku', 'like', `%${query.search}%`)
        .orWhere('i.name', 'like', `%${query.search}%`));
    }).select('i.*', 'c.name as category_name')
      .select(this.db.raw('(i.current_quantity <= i.reorder_level) as low_stock'))
      .orderBy('i.name').limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return rows.map((row) => ({ ...mapItem(row), category: row.category_name ?? '' }));
  },
  async createInventoryItem(data, actor) {
    const category = await this.db('inventory_categories').where({
      id: data.categoryId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      status: 'active'
    }).whereNull('archived_at').first('id');
    if (!category) throw inventoryError('INVENTORY_CATEGORY_NOT_FOUND', 'Active category not found.', 404);
    const row = { id: randomUUID(), organization_id: actor.orgId,
      campus_id: actor.activeCampusId, category_id: data.categoryId, sku: data.sku,
      name: data.name, unit: data.unit, reorder_level: data.reorderLevel,
      current_quantity: 0, average_unit_cost_minor: 0, currency_code: data.currencyCode,
      status: 'active' };
    try {
      await this.db.transaction(async (trx) => {
        await trx('inventory_items').insert(row);
        await audit(trx, actor, 'item_created', 'inventory_item', row.id, null, data);
      });
    } catch (error) {
      if (duplicate(error)) throw inventoryError('INVENTORY_SKU_DUPLICATE', 'SKU already exists.');
      throw error;
    }
    return mapItem(await this.db('inventory_items').where({ id: row.id,
      organization_id: actor.orgId, campus_id: actor.activeCampusId }).first());
  },
  async updateInventoryItem(id, data, actor) {
    const where = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const current = await trx('inventory_items').where(where).forUpdate().first();
      if (!current || current.archived_at) return null;
      if (data.categoryId) {
        const category = await trx('inventory_categories').where({
          id: data.categoryId, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).whereNull('archived_at').first('id');
        if (!category) throw inventoryError('INVENTORY_CATEGORY_NOT_FOUND', 'Category not found.', 404);
      }
      const updates = {
        ...(data.categoryId ? { category_id: data.categoryId } : {}),
        ...(data.sku ? { sku: data.sku } : {}),
        ...(data.name ? { name: data.name } : {}),
        ...(data.unit ? { unit: data.unit } : {}),
        ...(data.reorderLevel !== undefined ? { reorder_level: data.reorderLevel } : {}),
        updated_at: trx.fn.now()
      };
      try { await trx('inventory_items').where(where).update(updates); }
      catch (error) {
        if (duplicate(error)) throw inventoryError('INVENTORY_SKU_DUPLICATE', 'SKU already exists.');
        throw error;
      }
      await audit(trx, actor, 'item_updated', 'inventory_item', id, mapItem(current), data);
      return true;
    });
    return result ? mapItem(await this.db('inventory_items').where(where).first()) : null;
  },
  async archiveInventoryItem(id, actor) {
    const where = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const item = await trx('inventory_items').where(where).forUpdate().first();
      if (!item) return null;
      if (item.current_quantity !== 0) throw inventoryError('INVENTORY_ITEM_HAS_STOCK',
        'Items must have zero stock before they can be archived.');
      await trx('inventory_items').where(where).update({ status: 'archived',
        archived_at: trx.fn.now(), updated_at: trx.fn.now() });
      await audit(trx, actor, 'item_archived', 'inventory_item', id, mapItem(item), { status: 'archived' });
      return true;
    });
    return result ? mapItem(await this.db('inventory_items').where(where).first()) : null;
  },
  async listInventoryPurchases(query, actor) {
    const rows = await this.db('inventory_purchases as p').where({
      'p.organization_id': actor.orgId, 'p.campus_id': actor.activeCampusId
    }).leftJoin('inventory_suppliers as s', function joinSupplier() {
      this.on('s.id', '=', 'p.supplier_id').andOn('s.organization_id', '=', 'p.organization_id')
        .andOn('s.campus_id', '=', 'p.campus_id');
    }).modify((q) => {
      if (query.status) q.where('p.status', query.status);
      if (query.supplierId) q.where('p.supplier_id', query.supplierId);
      if (query.search) q.where('p.purchase_number', 'like', `%${query.search}%`);
    }).select('p.*', 's.name as supplier_name').orderBy('p.purchased_on', 'desc')
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const ids = rows.map((row) => row.id);
    const lines = ids.length ? await this.db('inventory_purchase_lines as l')
      .join('inventory_items as i', function joinItem() {
        this.on('i.id', '=', 'l.item_id').andOn('i.organization_id', '=', 'l.organization_id')
          .andOn('i.campus_id', '=', 'l.campus_id');
      }).where({ 'l.organization_id': actor.orgId, 'l.campus_id': actor.activeCampusId })
      .whereIn('l.purchase_id', ids).select('l.*', 'i.name as item_name', 'i.sku')
      .orderBy('l.purchase_id', 'asc').orderBy('l.line_number', 'asc') : [];
    return rows.map((row) => ({ ...mapPurchase(row), supplier: {
      id: row.supplier_id, name: row.supplier_name
    }, lines: lines.filter((line) => line.purchase_id === row.id)
      .map((line) => ({ ...mapPurchaseLine(line), item: { id: line.item_id,
        name: line.item_name, sku: line.sku } })) }));
  },
  async createInventoryPurchase(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        const supplier = await trx('inventory_suppliers').where({
          id: data.supplierId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).whereNull('archived_at').first('id');
        if (!supplier) throw inventoryError('INVENTORY_SUPPLIER_NOT_FOUND', 'Active supplier not found.', 404);
        const itemIds = [...new Set(data.lines.map((line) => line.itemId))];
        const items = await trx('inventory_items').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'active'
        }).whereNull('archived_at').whereIn('id', itemIds).select('id', 'currency_code');
        if (items.length !== itemIds.length) throw inventoryError('INVENTORY_ITEM_NOT_FOUND',
          'An active purchase item was not found.', 404);
        if (items.some((item) => item.currency_code !== data.currencyCode)) {
          throw inventoryError('INVENTORY_CURRENCY_MISMATCH',
            'Purchase and stock item currencies must match.');
        }
        await trx('inventory_purchases').insert({
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          purchase_number: data.purchaseNumber, supplier_id: data.supplierId,
          purchased_on: data.purchasedOn, expected_on: data.expectedOn,
          currency_code: data.currencyCode, status: 'draft', notes: data.notes, created_by: actor.sub
        });
        await trx('inventory_purchase_lines').insert(data.lines.map((line, index) => ({
          id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
          purchase_id: id, item_id: line.itemId, quantity: line.quantity,
          line_number: index + 1, received_quantity: 0, unit_cost_minor: line.unitCostMinor
        })));
        await audit(trx, actor, 'purchase_created', 'inventory_purchase', id, null, data);
      });
    } catch (error) {
      if (duplicate(error)) throw inventoryError('INVENTORY_PURCHASE_DUPLICATE', 'Purchase number already exists.');
      throw error;
    }
    const purchase = await this.db('inventory_purchases as p')
      .leftJoin('inventory_suppliers as s', function joinSupplier() {
        this.on('s.id', '=', 'p.supplier_id').andOn('s.organization_id', '=', 'p.organization_id')
          .andOn('s.campus_id', '=', 'p.campus_id');
      }).where({ 'p.id': id, 'p.organization_id': actor.orgId,
        'p.campus_id': actor.activeCampusId }).select('p.*', 's.name as supplier_name').first();
    if (!purchase) return null;
    const lines = await this.db('inventory_purchase_lines as l')
      .join('inventory_items as i', function joinItem() {
        this.on('i.id', '=', 'l.item_id').andOn('i.organization_id', '=', 'l.organization_id')
          .andOn('i.campus_id', '=', 'l.campus_id');
      }).where({ 'l.purchase_id': id, 'l.organization_id': actor.orgId,
        'l.campus_id': actor.activeCampusId }).select('l.*', 'i.name as item_name', 'i.sku')
      .orderBy('l.line_number', 'asc');
    return { ...mapPurchase(purchase), supplier: {
      id: purchase.supplier_id, name: purchase.supplier_name
    }, lines: lines.map((line) => ({ ...mapPurchaseLine(line),
      item: { id: line.item_id, name: line.item_name, sku: line.sku } })) };
  },
  async updateInventoryPurchase(id, data, actor) {
    const where = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    try {
      const updated = await this.db.transaction(async (trx) => {
        const purchase = await trx('inventory_purchases').where(where).forUpdate().first();
        if (!purchase) return false;
        if (purchase.status !== 'draft') throw inventoryError('INVENTORY_PURCHASE_INVALID_STATE',
          'Only draft purchases can be edited.');
        const previousLines = await trx('inventory_purchase_lines').where({
          purchase_id: id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).orderBy('line_number', 'asc').forUpdate();
        if (previousLines.some((line) => line.received_quantity !== 0)) {
          throw inventoryError('INVENTORY_PURCHASE_INVALID_STATE',
            'Purchases with received quantities cannot be edited.');
        }
        const supplier = await trx('inventory_suppliers').where({
          id: data.supplierId, organization_id: actor.orgId,
          campus_id: actor.activeCampusId, status: 'active'
        }).whereNull('archived_at').first('id');
        if (!supplier) throw inventoryError('INVENTORY_SUPPLIER_NOT_FOUND',
          'Active supplier not found.', 404);
        const itemIds = [...new Set(data.lines.map((line) => line.itemId))];
        const items = await trx('inventory_items').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'active'
        }).whereNull('archived_at').whereIn('id', itemIds).select('id', 'currency_code');
        if (items.length !== itemIds.length) throw inventoryError('INVENTORY_ITEM_NOT_FOUND',
          'An active purchase item was not found.', 404);
        if (items.some((item) => item.currency_code !== data.currencyCode)) {
          throw inventoryError('INVENTORY_CURRENCY_MISMATCH',
            'Purchase and stock item currencies must match.');
        }
        const duplicate = await trx('inventory_purchases').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          purchase_number: data.purchaseNumber
        }).whereNot('id', id).first('id');
        if (duplicate) throw inventoryError('INVENTORY_PURCHASE_DUPLICATE',
          'Purchase number already exists.');
        const before = { ...mapPurchase(purchase), lines: previousLines.map(mapPurchaseLine) };
        await trx('inventory_purchases').where(where).update({
          purchase_number: data.purchaseNumber, supplier_id: data.supplierId,
          purchased_on: data.purchasedOn, expected_on: data.expectedOn,
          currency_code: data.currencyCode, notes: data.notes, updated_at: trx.fn.now()
        });
        await trx('inventory_purchase_lines').where({
          purchase_id: id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).del();
        const lines = data.lines.map((line, index) => ({
          id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
          purchase_id: id, item_id: line.itemId, quantity: line.quantity,
          line_number: index + 1, received_quantity: 0, unit_cost_minor: line.unitCostMinor
        }));
        await trx('inventory_purchase_lines').insert(lines);
        await audit(trx, actor, 'purchase_updated', 'inventory_purchase', id, before,
          { ...data, status: 'draft', lines: lines.map(mapPurchaseLine) });
        return true;
      });
      if (!updated) return null;
      const purchase = await this.db('inventory_purchases as p')
        .leftJoin('inventory_suppliers as s', function joinSupplier() {
          this.on('s.id', '=', 'p.supplier_id').andOn('s.organization_id', '=', 'p.organization_id')
            .andOn('s.campus_id', '=', 'p.campus_id');
        }).where({ 'p.id': id, 'p.organization_id': actor.orgId,
          'p.campus_id': actor.activeCampusId }).select('p.*', 's.name as supplier_name').first();
      const lines = await this.db('inventory_purchase_lines as l')
        .join('inventory_items as i', function joinItem() {
          this.on('i.id', '=', 'l.item_id').andOn('i.organization_id', '=', 'l.organization_id')
            .andOn('i.campus_id', '=', 'l.campus_id');
        }).where({ 'l.purchase_id': id, 'l.organization_id': actor.orgId,
          'l.campus_id': actor.activeCampusId }).select('l.*', 'i.name as item_name', 'i.sku')
        .orderBy('l.line_number', 'asc');
      const purchaseLines = lines.map((line) => ({ ...mapPurchaseLine(line),
        item: { id: line.item_id, name: line.item_name, sku: line.sku } }));
      return { ...mapPurchase(purchase), supplier: {
        id: purchase.supplier_id, name: purchase.supplier_name
      }, lines: purchaseLines };
    } catch (error) {
      if (duplicate(error)) throw inventoryError('INVENTORY_PURCHASE_DUPLICATE',
        'Purchase number already exists.');
      throw error;
    }
  },
  async updateInventoryPurchaseStatus(id, status, actor) {
    const where = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const row = await trx('inventory_purchases').where(where).forUpdate().first();
      if (!row) return null;
      const allowed = row.status === 'draft' && ['ordered', 'cancelled'].includes(status) ||
        row.status === 'ordered' && status === 'cancelled';
      if (!allowed) throw inventoryError('INVENTORY_PURCHASE_INVALID_STATE',
        'Purchase cannot transition to the requested status.');
      await trx('inventory_purchases').where(where).update({ status, updated_at: trx.fn.now() });
      await audit(trx, actor, 'purchase_status_changed', 'inventory_purchase', id,
        mapPurchase(row), { ...mapPurchase(row), status });
      return true;
    });
    return result ? mapPurchase(await this.db('inventory_purchases').where(where).first()) : null;
  },
  async receiveInventoryPurchase(id, data, actor) {
    try {
      const receiptId = await this.db.transaction(async (trx) => {
        const purchase = await trx('inventory_purchases').where({
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).forUpdate().first();
        if (!purchase) return null;
        const existing = await trx('inventory_receipts').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).forUpdate().first();
        if (existing) {
          if (existing.purchase_id !== id) throw inventoryError('INVENTORY_IDEMPOTENCY_CONFLICT',
            'Idempotency key was already used for a different purchase.');
          return existing.id;
        }
        if (!['ordered', 'partially_received'].includes(purchase.status)) {
          throw inventoryError('INVENTORY_PURCHASE_INVALID_STATE', 'Only ordered purchases can be received.');
        }
        const receiptLines = [];
        for (const requested of data.lines) {
          const line = await trx('inventory_purchase_lines').where({
            id: requested.purchaseLineId, purchase_id: id,
            organization_id: actor.orgId, campus_id: actor.activeCampusId
          }).forUpdate().first();
          if (!line || requested.quantity > line.quantity - line.received_quantity) {
            throw inventoryError('INVENTORY_RECEIPT_QUANTITY_INVALID',
              'Receipt quantity exceeds the remaining purchase quantity.');
          }
          const item = await trx('inventory_items').where({
            id: line.item_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
          }).forUpdate().first();
          if (!item) throw inventoryError('INVENTORY_ITEM_NOT_FOUND', 'Purchase item not found.', 404);
          receiptLines.push({ line, item, quantity: requested.quantity });
        }
        const receipt = { id: randomUUID(), organization_id: actor.orgId,
          campus_id: actor.activeCampusId, purchase_id: id, idempotency_key: data.idempotencyKey,
          received_on: data.receivedOn, received_by: actor.sub };
        await trx('inventory_receipts').insert(receipt);
        for (const { line, item, quantity } of receiptLines) {
          const quantityAfter = integer(BigInt(item.current_quantity) + BigInt(quantity), 'Stock quantity');
          const average = averageCost(item.current_quantity,
            integer(item.average_unit_cost_minor, 'Average unit cost'), quantity,
            integer(line.unit_cost_minor, 'Purchase unit cost'));
          await trx('inventory_items').where({ id: item.id, organization_id: actor.orgId,
            campus_id: actor.activeCampusId }).update({ current_quantity: quantityAfter,
            average_unit_cost_minor: average, updated_at: trx.fn.now() });
          await trx('inventory_purchase_lines').where({ id: line.id,
            organization_id: actor.orgId, campus_id: actor.activeCampusId })
            .increment('received_quantity', quantity).update({ updated_at: trx.fn.now() });
          const movementId = randomUUID();
          await trx('inventory_movements').insert({
            id: movementId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
            item_id: item.id, movement_type: 'in', quantity_delta: quantity, quantity_after: quantityAfter,
            unit_cost_minor: line.unit_cost_minor,
            total_cost_minor: integer(BigInt(quantity) * BigInt(line.unit_cost_minor), 'Receipt value'),
            currency_code: purchase.currency_code, purchase_id: id, receipt_id: receipt.id,
            moved_on: data.receivedOn, reason: `Purchase ${purchase.purchase_number}`,
            created_by: actor.sub
          });
          await trx('inventory_receipt_lines').insert({
            id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
            receipt_id: receipt.id, purchase_line_id: line.id, quantity
          });
          await notifyLowStock(trx, actor, { ...item, current_quantity: quantityAfter }, movementId);
        }
        const remaining = await trx('inventory_purchase_lines').where({
          purchase_id: id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).whereRaw('received_quantity < quantity').first('id');
        const status = remaining ? 'partially_received' : 'received';
        await trx('inventory_purchases').where({ id, organization_id: actor.orgId,
          campus_id: actor.activeCampusId }).update({ status, updated_at: trx.fn.now() });
        await audit(trx, actor, 'purchase_received', 'inventory_receipt', receipt.id, null,
          { purchaseId: id, receivedOn: data.receivedOn, lines: data.lines });
        return receipt.id;
      });
      if (!receiptId) return null;
      const row = await this.db('inventory_receipts').where({
        id: receiptId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first();
      return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
        purchaseId: row.purchase_id, idempotencyKey: row.idempotency_key,
        receivedOn: dateOnly(row.received_on), receivedBy: row.received_by,
        createdAt: row.created_at };
    } catch (error) {
      if (duplicate(error)) {
        const existing = await this.db('inventory_receipts').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).first();
        if (existing) return { id: existing.id, organizationId: existing.organization_id,
          campusId: existing.campus_id, purchaseId: existing.purchase_id,
          idempotencyKey: existing.idempotency_key, receivedOn: dateOnly(existing.received_on),
          receivedBy: existing.received_by, createdAt: existing.created_at };
      }
      throw error;
    }
  },
  async createInventoryMovement(data, actor) {
    if (data.idempotencyKey) {
      const repeated = await this.db('inventory_movements').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (repeated) return mapMovement(repeated);
    }
    try {
      const id = await this.db.transaction(async (trx) => {
        const item = await trx('inventory_items').where({
          id: data.itemId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          status: 'active'
        }).whereNull('archived_at').forUpdate().first();
        if (!item) throw inventoryError('INVENTORY_ITEM_NOT_FOUND', 'Active item not found.', 404);
        if (data.movementType !== 'adjustment' && data.quantity <= 0 ||
            data.movementType === 'adjustment' && data.quantity === 0) {
          throw inventoryError('INVENTORY_ADJUSTMENT_INVALID',
            'Movement quantity must be non-zero, and in/out quantities must be positive.', 400);
        }
        const delta = data.movementType === 'in' ? data.quantity :
          data.movementType === 'out' ? -data.quantity : data.quantity;
        const nextValue = BigInt(item.current_quantity) + BigInt(delta);
        if (nextValue < 0n) throw inventoryError('INVENTORY_STOCK_INSUFFICIENT',
          'Stock cannot be negative.');
        const next = integer(nextValue, 'Stock quantity');
        const cost = data.movementType === 'in'
          ? data.unitCostMinor : integer(item.average_unit_cost_minor, 'Average unit cost');
        const average = data.movementType === 'in'
          ? averageCost(item.current_quantity, integer(item.average_unit_cost_minor, 'Average unit cost'),
            data.quantity, cost)
          : integer(item.average_unit_cost_minor, 'Average unit cost');
        const movementId = randomUUID();
        await trx('inventory_items').where({ id: item.id, organization_id: actor.orgId,
          campus_id: actor.activeCampusId }).update({ current_quantity: next,
          average_unit_cost_minor: average, updated_at: trx.fn.now() });
        await trx('inventory_movements').insert({
          id: movementId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          item_id: item.id, movement_type: data.movementType, quantity_delta: delta,
          quantity_after: next, unit_cost_minor: cost,
          total_cost_minor: integer(BigInt(Math.abs(delta)) * BigInt(cost), 'Movement value'),
          currency_code: item.currency_code, idempotency_key: data.idempotencyKey ?? null,
          moved_on: data.movedOn, reason: data.reason, created_by: actor.sub
        });
        await audit(trx, actor, data.movementType === 'adjustment'
          ? 'stock_adjusted' : 'stock_moved', 'inventory_movement', movementId, null, data);
        if (next <= item.reorder_level) {
          await notifyLowStock(trx, actor, { ...item, current_quantity: next }, movementId);
        }
        return movementId;
      });
      return mapMovement(await this.db('inventory_movements').where({ id,
        organization_id: actor.orgId, campus_id: actor.activeCampusId }).first());
    } catch (error) {
      if (duplicate(error) && data.idempotencyKey) {
        const repeated = await this.db('inventory_movements').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          idempotency_key: data.idempotencyKey
        }).first();
        if (repeated) return mapMovement(repeated);
      }
      throw error;
    }
  },
  async listInventoryMovements(query, actor) {
    const rows = await this.db('inventory_movements as m').join('inventory_items as i', function joinItem() {
      this.on('i.id', '=', 'm.item_id').andOn('i.organization_id', '=', 'm.organization_id')
        .andOn('i.campus_id', '=', 'm.campus_id');
    }).where({ 'm.organization_id': actor.orgId, 'm.campus_id': actor.activeCampusId })
      .modify((q) => {
        if (query.itemId) q.where('m.item_id', query.itemId);
        if (query.status) q.where('m.movement_type', query.status);
        if (query.search) q.where('m.reason', 'like', `%${query.search}%`);
      }).select('m.*', 'i.sku', 'i.name as item_name').orderBy('m.moved_on', 'desc')
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return rows.map((row) => ({ ...mapMovement(row), item: {
      id: row.item_id, sku: row.sku, name: row.item_name
    } }));
  },
  async getInventoryDashboard(actor) {
    const items = await this.db('inventory_items').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'active'
    }).whereNull('archived_at').select('id', 'name', 'unit', 'current_quantity',
      'reorder_level', 'average_unit_cost_minor', 'currency_code');
    const assets = await this.db('fixed_assets').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').whereNotIn('status', ['disposed', 'lost']).select('status');
    const valuesByCurrency = new Map();
    for (const item of items) {
      valuesByCurrency.set(item.currency_code, (valuesByCurrency.get(item.currency_code) ?? 0n) +
        BigInt(item.current_quantity) * BigInt(item.average_unit_cost_minor));
    }
    return { itemCount: items.length,
      lowStockCount: items.filter((item) => item.current_quantity <= item.reorder_level).length,
      stockValueByCurrency: [...valuesByCurrency].map(([currencyCode, value]) => ({
        currencyCode, amountMinor: integer(value, 'Stock valuation')
      })),
      assetsAvailable: assets.filter((asset) => asset.status === 'available').length,
      assetsAllocated: assets.filter((asset) => asset.status === 'allocated').length,
      lowStockItems: items.filter((item) => item.current_quantity <= item.reorder_level) };
  },
  async listFixedAssets(query, actor) {
    const rows = await this.db('fixed_assets as a').where({
      'a.organization_id': actor.orgId, 'a.campus_id': actor.activeCampusId
    }).modify((q) => {
      if (query.status === 'archived') q.whereNotNull('a.archived_at');
      else q.whereNull('a.archived_at');
      if (query.status && query.status !== 'archived') q.where('a.status', query.status);
      if (query.search) q.where((search) => search.where('a.asset_tag', 'like', `%${query.search}%`)
        .orWhere('a.name', 'like', `%${query.search}%`).orWhere('a.category', 'like', `%${query.search}%`));
    }).orderBy('a.asset_tag').limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const assets = rows.map(mapAsset);
    const ids = assets.map((asset) => asset.id);
    const allocations = ids.length ? await this.db('asset_allocations').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'active'
    }).whereIn('asset_id', ids) : [];
    return assets.map((asset) => {
      const allocation = allocations.find((row) => row.asset_id === asset.id);
      return { ...asset, allocation: allocation ? mapAllocation(allocation) : null };
    });
  },
  async createFixedAsset(data, actor) {
    const row = { id: randomUUID(), organization_id: actor.orgId,
      campus_id: actor.activeCampusId, asset_tag: data.assetTag, category: data.category,
      name: data.name, purchased_on: data.purchasedOn, purchase_cost_minor: data.purchaseCostMinor,
      currency_code: data.currencyCode, condition: data.condition, location: data.location,
      status: 'available', notes: data.notes };
    try {
      await this.db.transaction(async (trx) => {
        await trx('fixed_assets').insert(row);
        await audit(trx, actor, 'asset_created', 'fixed_asset', row.id, null, data);
      });
    } catch (error) {
      if (duplicate(error)) throw inventoryError('INVENTORY_ASSET_TAG_DUPLICATE', 'Asset tag already exists.');
      throw error;
    }
    return mapAsset(await this.db('fixed_assets').where({ id: row.id,
      organization_id: actor.orgId, campus_id: actor.activeCampusId }).first());
  },
  async updateFixedAsset(id, data, actor) {
    const where = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const row = await trx('fixed_assets').where(where).forUpdate().first();
      if (!row || row.archived_at || ['lost', 'disposed'].includes(row.status)) return null;
      const updates = {
        ...(data.assetTag ? { asset_tag: data.assetTag } : {}),
        ...(data.category ? { category: data.category } : {}),
        ...(data.name ? { name: data.name } : {}),
        ...(data.purchasedOn ? { purchased_on: data.purchasedOn } : {}),
        ...(data.purchaseCostMinor !== undefined ? { purchase_cost_minor: data.purchaseCostMinor } : {}),
        ...(data.currencyCode ? { currency_code: data.currencyCode } : {}),
        ...(data.condition ? { condition: data.condition } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        updated_at: trx.fn.now()
      };
      try { await trx('fixed_assets').where(where).update(updates); }
      catch (error) {
        if (duplicate(error)) throw inventoryError('INVENTORY_ASSET_TAG_DUPLICATE', 'Asset tag already exists.');
        throw error;
      }
      await audit(trx, actor, 'asset_updated', 'fixed_asset', id, mapAsset(row), data);
      return true;
    });
    return result ? mapAsset(await this.db('fixed_assets').where(where).first()) : null;
  },
  async archiveFixedAsset(id, actor) {
    const where = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const asset = await trx('fixed_assets').where(where).forUpdate().first();
      if (!asset || asset.archived_at) return null;
      if (asset.status === 'allocated' || await trx('asset_allocations').where({
        asset_id: id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        status: 'active'
      }).first('id')) {
        throw inventoryError('INVENTORY_ASSET_ACTIVE_ALLOCATION',
          'An allocated asset must be returned before it can be archived.');
      }
      await trx('fixed_assets').where(where).update({
        archived_at: trx.fn.now(), updated_at: trx.fn.now()
      });
      await audit(trx, actor, 'asset_archived', 'fixed_asset', id, mapAsset(asset),
        { archived: true });
      return true;
    });
    return result ? mapAsset(await this.db('fixed_assets').where(where).first()) : null;
  },
  async updateFixedAssetStatus(id, data, actor) {
    const where = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const row = await trx('fixed_assets').where(where).forUpdate().first();
      if (!row) return null;
      if (row.archived_at || ['disposed', 'lost', 'allocated'].includes(row.status)) {
        throw inventoryError('INVENTORY_ASSET_INVALID_STATE',
          'Allocated, lost, or disposed assets cannot be lost or disposed until returned.');
      }
      await trx('fixed_assets').where(where).update({
        status: data.status, condition: data.status,
        ...(data.status === 'disposed' ? { disposed_at: trx.fn.now() } : { lost_at: trx.fn.now() }),
        updated_at: trx.fn.now()
      });
      await audit(trx, actor, `asset_${data.status}`, 'fixed_asset', id, mapAsset(row),
        { ...data });
      return true;
    });
    return result ? mapAsset(await this.db('fixed_assets').where(where).first()) : null;
  },
  async listAssetAllocations(query, actor) {
    const rows = await this.db('asset_allocations')
      .where({ organization_id: actor.orgId, campus_id: actor.activeCampusId })
      .modify((q) => {
        if (query.status) q.where('status', query.status);
        if (query.itemId) q.where('asset_id', query.itemId);
      }).orderBy('allocated_on', 'desc').limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const assets = rows.length ? await this.db('fixed_assets').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereIn('id', rows.map((row) => row.asset_id)) : [];
    const assetById = new Map(assets.map((asset) => [asset.id, mapAsset(asset)]));
    return rows.map((row) => ({
      ...mapAllocation(row), asset: assetById.get(row.asset_id) ?? null
    }));
  },
  async allocateFixedAsset(id, data, actor) {
    try {
      const allocationId = await this.db.transaction(async (trx) => {
        const asset = await trx('fixed_assets').where({
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).forUpdate().first();
        if (!asset) return null;
        if (asset.archived_at || asset.status !== 'available' || asset.disposed_at || asset.lost_at) {
          throw inventoryError('INVENTORY_ASSET_UNAVAILABLE', 'Only available assets can be allocated.');
        }
        if (data.staffId) {
          const staff = await trx('staff').where({ id: data.staffId,
            organization_id: actor.orgId, campus_id: actor.activeCampusId,
            employment_status: 'active' }).whereNull('archived_at').first('id');
          if (!staff) throw inventoryError('INVENTORY_ALLOCATION_TARGET_NOT_FOUND',
            'Active staff member not found.', 404);
        }
        if (data.roomId) {
          const room = await trx('rooms as r').join('campuses as c', 'c.id', 'r.campus_id')
            .where({ 'r.id': data.roomId, 'r.campus_id': actor.activeCampusId,
              'c.organization_id': actor.orgId }).first('r.id');
          if (!room) throw inventoryError('INVENTORY_ALLOCATION_TARGET_NOT_FOUND',
            'Room not found in the active campus.', 404);
        }
        const newId = randomUUID();
        await trx('asset_allocations').insert({
          id: newId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          asset_id: id, active_asset_id: id, staff_id: data.staffId, room_id: data.roomId,
          allocated_on: data.allocatedOn, status: 'active', allocated_by: actor.sub,
          notes: data.notes
        });
        await trx('fixed_assets').where({ id, organization_id: actor.orgId,
          campus_id: actor.activeCampusId }).update({ status: 'allocated',
          active_allocation_id: newId, updated_at: trx.fn.now() });
        await audit(trx, actor, 'asset_allocated', 'asset_allocation', newId, null, data);
        if (data.staffId) {
          const staff = await trx('staff').where({ id: data.staffId,
            organization_id: actor.orgId, campus_id: actor.activeCampusId }).first('user_id');
          if (staff?.user_id) await trx('user_notifications').insert({
            id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
            user_id: staff.user_id, source_type: 'inventory_asset_allocation',
            source_id: newId, title_en: 'Asset allocated', title_am: 'Asset allocated',
            body_en: `Asset ${asset.asset_tag} was allocated to you.`,
            body_am: `Asset ${asset.asset_tag} was allocated to you.`
          }).onConflict(['user_id', 'source_type', 'source_id']).ignore();
        }
        return newId;
      });
      return allocationId ? mapAllocation(await this.db('asset_allocations').where({
        id: allocationId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first()) : null;
    } catch (error) {
      if (duplicate(error)) throw inventoryError('INVENTORY_ASSET_UNAVAILABLE',
        'Asset is already actively allocated.');
      throw error;
    }
  },
  async returnFixedAsset(id, data, actor) {
    const where = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const allocationId = await this.db.transaction(async (trx) => {
      const allocation = await trx('asset_allocations').where(where).forUpdate().first();
      if (!allocation || allocation.status !== 'active') return null;
      const asset = await trx('fixed_assets').where({ id: allocation.asset_id,
        organization_id: actor.orgId, campus_id: actor.activeCampusId }).forUpdate().first();
      await trx('asset_allocations').where(where).update({
        status: 'returned', active_asset_id: null, returned_on: data.returnedOn,
        returned_by: actor.sub, updated_at: trx.fn.now()
      });
      if (asset) await trx('fixed_assets').where({ id: asset.id,
        organization_id: actor.orgId, campus_id: actor.activeCampusId }).update({
        status: 'available', active_allocation_id: null, updated_at: trx.fn.now()
      });
      await audit(trx, actor, 'asset_returned', 'asset_allocation', id, mapAllocation(allocation), data);
      return id;
    });
    return allocationId ? mapAllocation(await this.db('asset_allocations').where(where).first()) : null;
  },
  async addAssetMaintenance(id, data, actor) {
    const asset = await this.db('fixed_assets').where({ id,
      organization_id: actor.orgId, campus_id: actor.activeCampusId }).first('id');
    if (!asset) return null;
    const row = { id: randomUUID(), organization_id: actor.orgId,
      campus_id: actor.activeCampusId, asset_id: id, maintenance_on: data.maintenanceOn,
      note: data.note, cost_minor: data.costMinor, currency_code: data.currencyCode,
      created_by: actor.sub };
    await this.db.transaction(async (trx) => {
      await trx('asset_maintenance').insert(row);
      await audit(trx, actor, 'maintenance_added', 'asset_maintenance', row.id, null, data);
    });
    return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      assetId: row.asset_id, maintenanceOn: row.maintenance_on, note: row.note,
      costMinor: row.cost_minor, currencyCode: row.currency_code,
      createdBy: row.created_by };
  },
  async listAssetMaintenance(id, actor) {
    const asset = await this.db('fixed_assets').where({ id,
      organization_id: actor.orgId, campus_id: actor.activeCampusId }).first('id');
    if (!asset) return null;
    const rows = await this.db('asset_maintenance').where({ asset_id: id,
      organization_id: actor.orgId, campus_id: actor.activeCampusId })
      .orderBy('maintenance_on', 'desc').limit(100);
    return rows.map((row) => ({ id: row.id, organizationId: row.organization_id,
      campusId: row.campus_id, assetId: row.asset_id, maintenanceOn: dateOnly(row.maintenance_on),
      note: row.note, costMinor: integer(row.cost_minor, 'Maintenance cost'),
      currencyCode: row.currency_code, createdBy: row.created_by, createdAt: row.created_at }));
  },
  async getMyAllocatedAssets(actor) {
    const rows = await this.db('asset_allocations as l').join('fixed_assets as a', function joinAsset() {
      this.on('a.id', '=', 'l.asset_id').andOn('a.organization_id', '=', 'l.organization_id')
        .andOn('a.campus_id', '=', 'l.campus_id');
    }).join('staff as s', function joinStaff() {
      this.on('s.id', '=', 'l.staff_id').andOn('s.organization_id', '=', 'l.organization_id')
        .andOn('s.campus_id', '=', 'l.campus_id');
    }).where({ 'l.organization_id': actor.orgId, 'l.campus_id': actor.activeCampusId,
      'l.status': 'active', 's.user_id': actor.sub })
      .select('l.*', 'a.asset_tag', 'a.category', 'a.name', 'a.purchased_on',
        'a.purchase_cost_minor', 'a.currency_code', 'a.condition', 'a.location',
        'a.status as asset_status', 'a.active_allocation_id', 'a.notes as asset_notes',
        'a.disposed_at', 'a.lost_at', 'a.created_at as asset_created_at',
        'a.updated_at as asset_updated_at').limit(100);
    return rows.map((row) => ({ ...mapAllocation(row), asset: mapAsset({
      id: row.asset_id, organization_id: row.organization_id, campus_id: row.campus_id,
      asset_tag: row.asset_tag, category: row.category, name: row.name,
      purchased_on: row.purchased_on, purchase_cost_minor: row.purchase_cost_minor,
      currency_code: row.currency_code, condition: row.condition, location: row.location,
      status: row.asset_status, active_allocation_id: row.active_allocation_id,
      notes: row.asset_notes, disposed_at: row.disposed_at, lost_at: row.lost_at,
      created_at: row.asset_created_at, updated_at: row.asset_updated_at
    }) }));
  }
};
