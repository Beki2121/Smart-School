import { randomUUID } from 'node:crypto';
import { now } from '../shared.js';

function inventoryError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function scope(rows, actor) {
  return rows.filter((row) => row.organizationId === actor.orgId &&
    row.campusId === actor.activeCampusId);
}

function safeNumber(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw inventoryError('INVENTORY_VALUE_OVERFLOW', `${label} exceeds supported integer precision.`, 400);
  }
  return number;
}

function weightedAverage(quantity, average, addedQuantity, unitCost) {
  if (!quantity) return unitCost;
  const totalQuantity = BigInt(quantity + addedQuantity);
  const weighted = BigInt(quantity) * BigInt(average) +
    BigInt(addedQuantity) * BigInt(unitCost);
  return safeNumber((weighted + totalQuantity / 2n) / totalQuantity, 'Average cost');
}

function page(rows, query = {}) {
  const size = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
  const index = Math.max(1, Number(query.page) || 1);
  return rows.slice((index - 1) * size, index * size);
}

export const memoryInventoryBundle = {
  initInventory() {
    this.inventoryCategories ??= [];
    this.inventorySuppliers ??= [];
    this.inventoryItems ??= [];
    this.inventoryPurchases ??= [];
    this.inventoryPurchaseLines ??= [];
    this.inventoryReceipts ??= [];
    this.inventoryReceiptLines ??= [];
    this.inventoryMovements ??= [];
    this.fixedAssets ??= [];
    this.assetAllocations ??= [];
    this.assetMaintenance ??= [];
    this.userNotifications ??= [];
  },
  async inventoryAudit(actor, action, entity, id, before, after) {
    await this.appendAudit(actor, `inventory.${action}`, entity, id, before, after);
  },
  notifyInventoryLowStock(actor, item, movementId) {
    if (item.currentQuantity > item.reorderLevel) return;
    for (const user of this.users.filter((candidate) =>
      candidate.orgId === actor.orgId && candidate.isActive !== false &&
      candidate.campusIds?.includes(actor.activeCampusId) &&
      ['store_keeper', 'owner_director', 'principal', 'system_admin'].includes(candidate.role))) {
      if (this.userNotifications.some((notice) => notice.userId === user.id &&
          notice.sourceType === 'inventory_low_stock' && notice.sourceId === movementId)) continue;
      this.userNotifications.unshift({
        id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        userId: user.id, sourceType: 'inventory_low_stock', sourceId: movementId,
        titleEn: 'Low inventory stock', titleAm: 'Low inventory stock',
        bodyEn: `${item.name} is at or below its reorder level (${item.currentQuantity} ${item.unit}).`,
        bodyAm: `${item.name} is at or below its reorder level (${item.currentQuantity} ${item.unit}).`,
        readAt: null, createdAt: now()
      });
    }
  },
  async listInventoryCategories(actor) {
    this.initInventory();
    return scope(this.inventoryCategories, actor).filter((row) => !row.archivedAt)
      .sort((a, b) => a.name.localeCompare(b.name)).map((row) => structuredClone(row));
  },
  async createInventoryCategory(data, actor) {
    this.initInventory();
    if (scope(this.inventoryCategories, actor).some((row) =>
      row.name.toLowerCase() === data.name.toLowerCase())) {
      throw inventoryError('INVENTORY_CATEGORY_DUPLICATE', 'Category name already exists.');
    }
    const row = { id: randomUUID(), organizationId: actor.orgId,
      campusId: actor.activeCampusId, ...data, status: 'active', archivedAt: null,
      createdAt: now(), updatedAt: now() };
    this.inventoryCategories.push(row);
    await this.inventoryAudit(actor, 'category_created', 'inventory_category', row.id, null, row);
    return structuredClone(row);
  },
  async listInventorySuppliers(query, actor) {
    this.initInventory();
    const search = query.search?.toLowerCase();
    return page(scope(this.inventorySuppliers, actor).filter((row) =>
      (!row.archivedAt || query.status === 'archived') &&
      (!query.status || row.status === query.status) &&
      (!search || [row.name, row.contactName, row.email, row.phone].some((value) =>
        value.toLowerCase().includes(search)))).sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => structuredClone(row)), query);
  },
  async createInventorySupplier(data, actor) {
    this.initInventory();
    if (scope(this.inventorySuppliers, actor).some((row) =>
      row.name.toLowerCase() === data.name.toLowerCase() && !row.archivedAt)) {
      throw inventoryError('INVENTORY_SUPPLIER_DUPLICATE', 'Supplier already exists.');
    }
    const row = { id: randomUUID(), organizationId: actor.orgId,
      campusId: actor.activeCampusId, ...data, status: 'active', archivedAt: null,
      createdAt: now(), updatedAt: now() };
    this.inventorySuppliers.push(row);
    await this.inventoryAudit(actor, 'supplier_created', 'inventory_supplier', row.id, null, row);
    return structuredClone(row);
  },
  async listInventoryItems(query, actor) {
    this.initInventory();
    const search = query.search?.toLowerCase();
    return page(scope(this.inventoryItems, actor).filter((row) =>
      (!row.archivedAt || query.status === 'archived') &&
      (!query.status || row.status === query.status) &&
      (!query.categoryId || row.categoryId === query.categoryId) &&
      (!search || [row.sku, row.name, row.unit].some((value) =>
        value.toLowerCase().includes(search)))).sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => ({ ...structuredClone(row),
        category: structuredClone(this.inventoryCategories.find((category) =>
          category.id === row.categoryId && category.organizationId === actor.orgId &&
          category.campusId === actor.activeCampusId) ?? null),
        lowStock: row.currentQuantity <= row.reorderLevel })), query);
  },
  async createInventoryItem(data, actor) {
    this.initInventory();
    if (!scope(this.inventoryCategories, actor).some((row) =>
      row.id === data.categoryId && row.status === 'active' && !row.archivedAt)) {
      throw inventoryError('INVENTORY_CATEGORY_NOT_FOUND', 'Active category not found.', 404);
    }
    if (this.inventoryItems.some((row) => row.organizationId === actor.orgId &&
        row.sku.toLowerCase() === data.sku.toLowerCase())) {
      throw inventoryError('INVENTORY_SKU_DUPLICATE', 'SKU already exists.');
    }
    const row = { id: randomUUID(), organizationId: actor.orgId,
      campusId: actor.activeCampusId, ...data, currentQuantity: 0,
      averageUnitCostMinor: 0, status: 'active', archivedAt: null,
      createdAt: now(), updatedAt: now() };
    this.inventoryItems.push(row);
    await this.inventoryAudit(actor, 'item_created', 'inventory_item', row.id, null, row);
    return structuredClone(row);
  },
  async updateInventoryItem(id, data, actor) {
    this.initInventory();
    const row = scope(this.inventoryItems, actor).find((item) => item.id === id && !item.archivedAt);
    if (!row) return null;
    if (data.sku && this.inventoryItems.some((item) => item.id !== id &&
        item.organizationId === actor.orgId && item.sku.toLowerCase() === data.sku.toLowerCase())) {
      throw inventoryError('INVENTORY_SKU_DUPLICATE', 'SKU already exists.');
    }
    if (data.categoryId && !scope(this.inventoryCategories, actor).some((item) =>
      item.id === data.categoryId && !item.archivedAt)) {
      throw inventoryError('INVENTORY_CATEGORY_NOT_FOUND', 'Category not found.', 404);
    }
    const before = structuredClone(row);
    Object.assign(row, data, { updatedAt: now() });
    await this.inventoryAudit(actor, 'item_updated', 'inventory_item', id, before, row);
    return structuredClone(row);
  },
  async archiveInventoryItem(id, actor) {
    this.initInventory();
    const row = scope(this.inventoryItems, actor).find((item) => item.id === id && !item.archivedAt);
    if (!row) return null;
    if (row.currentQuantity !== 0) {
      throw inventoryError('INVENTORY_ITEM_HAS_STOCK', 'Items must have zero stock before they can be archived.');
    }
    const before = structuredClone(row);
    row.status = 'archived'; row.archivedAt = now(); row.updatedAt = now();
    await this.inventoryAudit(actor, 'item_archived', 'inventory_item', id, before, row);
    return structuredClone(row);
  },
  async listInventoryPurchases(query, actor) {
    this.initInventory();
    const search = query.search?.toLowerCase();
    return page(scope(this.inventoryPurchases, actor).filter((row) =>
      (!query.status || row.status === query.status) &&
      (!query.supplierId || row.supplierId === query.supplierId) &&
      (!search || row.purchaseNumber.toLowerCase().includes(search)))
      .sort((a, b) => b.purchasedOn.localeCompare(a.purchasedOn)).map((row) => ({
        ...structuredClone(row),
        supplier: structuredClone(this.inventorySuppliers.find((supplier) =>
          supplier.id === row.supplierId && supplier.organizationId === actor.orgId) ?? null),
        lines: this.inventoryPurchaseLines.filter((line) => line.purchaseId === row.id &&
          line.organizationId === actor.orgId && line.campusId === actor.activeCampusId)
          .map((line) => ({ ...structuredClone(line), item: structuredClone(
            this.inventoryItems.find((item) => item.id === line.itemId) ?? null) }))
      })), query);
  },
  async createInventoryPurchase(data, actor) {
    this.initInventory();
    if (!scope(this.inventorySuppliers, actor).some((row) =>
      row.id === data.supplierId && row.status === 'active' && !row.archivedAt)) {
      throw inventoryError('INVENTORY_SUPPLIER_NOT_FOUND', 'Active supplier not found.', 404);
    }
    if (scope(this.inventoryPurchases, actor).some((row) =>
      row.purchaseNumber.toLowerCase() === data.purchaseNumber.toLowerCase())) {
      throw inventoryError('INVENTORY_PURCHASE_DUPLICATE', 'Purchase number already exists.');
    }
    const items = data.lines.map((line) => scope(this.inventoryItems, actor).find((item) =>
      item.id === line.itemId && item.status === 'active' && !item.archivedAt));
    if (items.some((item) => !item)) {
      throw inventoryError('INVENTORY_ITEM_NOT_FOUND', 'An active purchase item was not found.', 404);
    }
    if (items.some((item) => item.currencyCode !== data.currencyCode)) {
      throw inventoryError('INVENTORY_CURRENCY_MISMATCH',
        'Purchase and stock item currencies must match.');
    }
    const purchase = { id: randomUUID(), organizationId: actor.orgId,
      campusId: actor.activeCampusId, purchaseNumber: data.purchaseNumber,
      supplierId: data.supplierId, purchasedOn: data.purchasedOn, expectedOn: data.expectedOn,
      currencyCode: data.currencyCode, status: 'draft', notes: data.notes,
      createdBy: actor.sub, createdAt: now(), updatedAt: now() };
    const lines = data.lines.map((line) => ({ id: randomUUID(), organizationId: actor.orgId,
      campusId: actor.activeCampusId, purchaseId: purchase.id, ...line,
      receivedQuantity: 0, createdAt: now(), updatedAt: now() }));
    this.inventoryPurchases.push(purchase);
    this.inventoryPurchaseLines.push(...lines);
    await this.inventoryAudit(actor, 'purchase_created', 'inventory_purchase', purchase.id,
      null, { ...purchase, lines });
    return structuredClone({ ...purchase, lines });
  },
  async updateInventoryPurchaseStatus(id, status, actor) {
    this.initInventory();
    const row = scope(this.inventoryPurchases, actor).find((item) => item.id === id);
    if (!row) return null;
    const allowed = row.status === 'draft' && ['ordered', 'cancelled'].includes(status) ||
      row.status === 'ordered' && status === 'cancelled';
    if (!allowed) throw inventoryError('INVENTORY_PURCHASE_INVALID_STATE',
      'Purchase cannot transition to the requested status.');
    const before = structuredClone(row);
    row.status = status; row.updatedAt = now();
    await this.inventoryAudit(actor, 'purchase_status_changed', 'inventory_purchase', id, before, row);
    return structuredClone(row);
  },
  async receiveInventoryPurchase(id, data, actor) {
    this.initInventory();
    const repeated = scope(this.inventoryReceipts, actor).find((receipt) =>
      receipt.idempotencyKey === data.idempotencyKey);
    if (repeated) {
      if (repeated.purchaseId !== id) {
        throw inventoryError('INVENTORY_IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for a different purchase.');
      }
      return structuredClone(repeated);
    }
    const purchase = scope(this.inventoryPurchases, actor).find((row) => row.id === id);
    if (!purchase) return null;
    if (!['ordered', 'partially_received'].includes(purchase.status)) {
      throw inventoryError('INVENTORY_PURCHASE_INVALID_STATE', 'Only ordered purchases can be received.');
    }
    const receiptLines = data.lines.map((requested) => {
      const line = this.inventoryPurchaseLines.find((item) => item.id === requested.purchaseLineId &&
        item.purchaseId === id && item.organizationId === actor.orgId &&
        item.campusId === actor.activeCampusId);
      if (!line || requested.quantity > line.quantity - line.receivedQuantity) {
        throw inventoryError('INVENTORY_RECEIPT_QUANTITY_INVALID',
          'Receipt quantity exceeds the remaining purchase quantity.');
      }
      return { line, quantity: requested.quantity };
    });
    const receipt = { id: randomUUID(), organizationId: actor.orgId,
      campusId: actor.activeCampusId, purchaseId: id, idempotencyKey: data.idempotencyKey,
      receivedOn: data.receivedOn, receivedBy: actor.sub, createdAt: now() };
    this.inventoryReceipts.push(receipt);
    for (const { line, quantity } of receiptLines) {
      const item = this.inventoryItems.find((candidate) => candidate.id === line.itemId &&
        candidate.organizationId === actor.orgId && candidate.campusId === actor.activeCampusId);
      const next = item.currentQuantity + quantity;
      const average = weightedAverage(item.currentQuantity, item.averageUnitCostMinor,
        quantity, line.unitCostMinor);
      item.currentQuantity = safeNumber(next, 'Stock quantity');
      item.averageUnitCostMinor = average;
      item.updatedAt = now();
      line.receivedQuantity += quantity;
      line.updatedAt = now();
      const movement = { id: randomUUID(), organizationId: actor.orgId,
        campusId: actor.activeCampusId, itemId: item.id, movementType: 'in',
        quantityDelta: quantity, quantityAfter: item.currentQuantity,
        unitCostMinor: line.unitCostMinor,
        totalCostMinor: safeNumber(BigInt(quantity) * BigInt(line.unitCostMinor), 'Receipt value'),
        currencyCode: purchase.currencyCode, purchaseId: id, receiptId: receipt.id,
        idempotencyKey: null, movedOn: data.receivedOn, reason: `Purchase ${purchase.purchaseNumber}`,
        createdBy: actor.sub, createdAt: now() };
      this.inventoryMovements.push(movement);
      this.notifyInventoryLowStock(actor, item, movement.id);
      this.inventoryReceiptLines.push({ id: randomUUID(), organizationId: actor.orgId,
        campusId: actor.activeCampusId, receiptId: receipt.id, purchaseLineId: line.id,
        quantity, createdAt: now() });
    }
    const lines = this.inventoryPurchaseLines.filter((line) => line.purchaseId === id &&
      line.organizationId === actor.orgId && line.campusId === actor.activeCampusId);
    purchase.status = lines.every((line) => line.receivedQuantity === line.quantity)
      ? 'received' : 'partially_received';
    purchase.updatedAt = now();
    await this.inventoryAudit(actor, 'purchase_received', 'inventory_receipt', receipt.id,
      null, { receipt, lines: receiptLines.map(({ line, quantity }) => ({
        purchaseLineId: line.id, quantity
      })) });
    return structuredClone(receipt);
  },
  async createInventoryMovement(data, actor) {
    this.initInventory();
    if (data.idempotencyKey) {
      const repeat = scope(this.inventoryMovements, actor).find((row) =>
        row.idempotencyKey === data.idempotencyKey);
      if (repeat) return structuredClone(repeat);
    }
    const item = scope(this.inventoryItems, actor).find((row) => row.id === data.itemId &&
      row.status === 'active' && !row.archivedAt);
    if (!item) throw inventoryError('INVENTORY_ITEM_NOT_FOUND', 'Active item not found.', 404);
    if (data.movementType !== 'adjustment' && data.quantity <= 0 ||
        data.movementType === 'adjustment' && data.quantity === 0) {
      throw inventoryError('INVENTORY_ADJUSTMENT_INVALID',
        'Movement quantity must be non-zero, and in/out quantities must be positive.', 400);
    }
    const delta = data.movementType === 'in' ? data.quantity :
      data.movementType === 'out' ? -data.quantity : data.quantity;
    if (data.movementType === 'adjustment' && data.quantity === 0) {
      throw inventoryError('INVENTORY_ADJUSTMENT_INVALID', 'Adjustment cannot be zero.', 400);
    }
    const next = item.currentQuantity + delta;
    if (next < 0) throw inventoryError('INVENTORY_STOCK_INSUFFICIENT', 'Stock cannot be negative.');
    const unitCostMinor = data.movementType === 'in'
      ? data.unitCostMinor : item.averageUnitCostMinor;
    const average = data.movementType === 'in'
      ? weightedAverage(item.currentQuantity, item.averageUnitCostMinor, data.quantity, unitCostMinor)
      : item.averageUnitCostMinor;
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      itemId: item.id, movementType: data.movementType, quantityDelta: delta,
      quantityAfter: safeNumber(next, 'Stock quantity'), unitCostMinor,
      totalCostMinor: safeNumber(BigInt(Math.abs(delta)) * BigInt(unitCostMinor), 'Movement value'),
      currencyCode: item.currencyCode, purchaseId: null, receiptId: null,
      idempotencyKey: data.idempotencyKey ?? null, movedOn: data.movedOn,
      reason: data.reason, createdBy: actor.sub, createdAt: now() };
    item.currentQuantity = row.quantityAfter;
    item.averageUnitCostMinor = average;
    item.updatedAt = now();
    this.inventoryMovements.push(row);
    this.notifyInventoryLowStock(actor, item, row.id);
    await this.inventoryAudit(actor, data.movementType === 'adjustment'
      ? 'stock_adjusted' : 'stock_moved', 'inventory_movement', row.id, null, row);
    return structuredClone(row);
  },
  async listInventoryMovements(query, actor) {
    this.initInventory();
    const search = query.search?.toLowerCase();
    const rows = scope(this.inventoryMovements, actor).filter((row) =>
      (!query.itemId || row.itemId === query.itemId) &&
      (!query.status || row.movementType === query.status) &&
      (!search || row.reason.toLowerCase().includes(search)))
      .sort((a, b) => b.movedOn.localeCompare(a.movedOn))
      .map((row) => ({ ...structuredClone(row), item: structuredClone(
        this.inventoryItems.find((item) => item.id === row.itemId) ?? null) }));
    return page(rows, query);
  },
  async getInventoryDashboard(actor) {
    this.initInventory();
    const items = scope(this.inventoryItems, actor).filter((row) => row.status === 'active' && !row.archivedAt);
    const assets = scope(this.fixedAssets ?? [], actor).filter((row) =>
      !row.archivedAt && !row.disposedAt && !row.lostAt);
    const valuesByCurrency = new Map();
    for (const row of items) {
      valuesByCurrency.set(row.currencyCode, (valuesByCurrency.get(row.currencyCode) ?? 0n) +
        BigInt(row.currentQuantity) * BigInt(row.averageUnitCostMinor));
    }
    return {
      itemCount: items.length, lowStockCount: items.filter((row) =>
        row.currentQuantity <= row.reorderLevel).length,
      stockValueByCurrency: [...valuesByCurrency].map(([currencyCode, value]) => ({
        currencyCode, amountMinor: safeNumber(value, 'Stock valuation')
      })),
      assetsAvailable: assets.filter((row) => row.status === 'available').length,
      assetsAllocated: assets.filter((row) => row.status === 'allocated').length,
      lowStockItems: items.filter((row) => row.currentQuantity <= row.reorderLevel)
        .map((row) => structuredClone(row))
    };
  },
  async listFixedAssets(query, actor) {
    this.initInventory();
    const search = query.search?.toLowerCase();
    return page(scope(this.fixedAssets, actor).filter((row) =>
      (!row.archivedAt || query.status === 'archived') &&
      (!query.status || query.status === 'archived' || row.status === query.status) &&
      (!query.categoryId || row.category === query.categoryId) &&
      (!search || [row.assetTag, row.name, row.category, row.location].some((value) =>
        value.toLowerCase().includes(search)))).sort((a, b) => a.assetTag.localeCompare(b.assetTag))
      .map((row) => ({ ...structuredClone(row), allocation: structuredClone(
        this.assetAllocations.find((allocation) => allocation.assetId === row.id &&
          allocation.status === 'active' && allocation.organizationId === actor.orgId &&
          allocation.campusId === actor.activeCampusId) ?? null) })), query);
  },
  async createFixedAsset(data, actor) {
    this.initInventory();
    if (this.fixedAssets.some((row) => row.organizationId === actor.orgId &&
        row.assetTag.toLowerCase() === data.assetTag.toLowerCase())) {
      throw inventoryError('INVENTORY_ASSET_TAG_DUPLICATE', 'Asset tag already exists.');
    }
    const row = { id: randomUUID(), organizationId: actor.orgId,
      campusId: actor.activeCampusId, ...data, status: 'available',
      activeAllocationId: null, archivedAt: null, disposedAt: null, lostAt: null,
      createdAt: now(), updatedAt: now() };
    this.fixedAssets.push(row);
    await this.inventoryAudit(actor, 'asset_created', 'fixed_asset', row.id, null, row);
    return structuredClone(row);
  },
  async updateFixedAsset(id, data, actor) {
    this.initInventory();
    const row = scope(this.fixedAssets, actor).find((asset) =>
      asset.id === id && !asset.archivedAt && asset.status !== 'disposed' && asset.status !== 'lost');
    if (!row) return null;
    if (data.assetTag && this.fixedAssets.some((asset) => asset.id !== id &&
        asset.organizationId === actor.orgId && asset.assetTag.toLowerCase() === data.assetTag.toLowerCase())) {
      throw inventoryError('INVENTORY_ASSET_TAG_DUPLICATE', 'Asset tag already exists.');
    }
    const before = structuredClone(row);
    Object.assign(row, data, { updatedAt: now() });
    await this.inventoryAudit(actor, 'asset_updated', 'fixed_asset', id, before, row);
    return structuredClone(row);
  },
  async archiveFixedAsset(id, actor) {
    this.initInventory();
    const row = scope(this.fixedAssets, actor).find((asset) =>
      asset.id === id && !asset.archivedAt);
    if (!row) return null;
    if (row.status === 'allocated' || this.assetAllocations.some((allocation) =>
      allocation.assetId === id && allocation.organizationId === actor.orgId &&
      allocation.campusId === actor.activeCampusId && allocation.status === 'active')) {
      throw inventoryError('INVENTORY_ASSET_ACTIVE_ALLOCATION',
        'An allocated asset must be returned before it can be archived.');
    }
    const before = structuredClone(row);
    row.archivedAt = now();
    row.updatedAt = now();
    await this.inventoryAudit(actor, 'asset_archived', 'fixed_asset', id, before, row);
    return structuredClone(row);
  },
  async updateFixedAssetStatus(id, data, actor) {
    this.initInventory();
    const row = scope(this.fixedAssets, actor).find((asset) => asset.id === id);
    if (!row) return null;
    if (row.archivedAt || row.status === 'disposed' || row.status === 'lost' || row.status === 'allocated') {
      throw inventoryError('INVENTORY_ASSET_INVALID_STATE',
        'Allocated, lost, or disposed assets cannot be lost or disposed until returned.');
    }
    const before = structuredClone(row);
    row.status = data.status;
    row.disposedAt = data.status === 'disposed' ? now() : row.disposedAt;
    row.lostAt = data.status === 'lost' ? now() : row.lostAt;
    row.condition = data.status;
    row.updatedAt = now();
    await this.inventoryAudit(actor, `asset_${data.status}`, 'fixed_asset', id, before,
      { ...row, reason: data.reason, changedOn: data.changedOn });
    return structuredClone(row);
  },
  async listAssetAllocations(query, actor) {
    this.initInventory();
    const rows = scope(this.assetAllocations, actor).filter((row) =>
      (!query.status || row.status === query.status) &&
      (!query.itemId || row.assetId === query.itemId))
      .sort((a, b) => b.allocatedOn.localeCompare(a.allocatedOn))
      .map((row) => ({ ...structuredClone(row), asset: structuredClone(
        this.fixedAssets.find((asset) => asset.id === row.assetId) ?? null) }));
    return page(rows, query);
  },
  async allocateFixedAsset(id, data, actor) {
    this.initInventory();
    const asset = scope(this.fixedAssets, actor).find((row) => row.id === id);
    if (!asset) return null;
    if (asset.archivedAt || asset.status !== 'available' || asset.disposedAt || asset.lostAt) {
      throw inventoryError('INVENTORY_ASSET_UNAVAILABLE', 'Only available assets can be allocated.');
    }
    if (data.staffId) {
      const staff = this.staff.find((row) => row.id === data.staffId &&
        row.organizationId === actor.orgId && row.campusId === actor.activeCampusId &&
        row.employmentStatus === 'active' && !row.archivedAt);
      if (!staff) throw inventoryError('INVENTORY_ALLOCATION_TARGET_NOT_FOUND',
        'Active staff member not found.', 404);
    }
    if (data.roomId) {
      const room = (this.rooms ?? []).find((row) => row.id === data.roomId &&
        row.campusId === actor.activeCampusId);
      const campus = this.campuses.find((row) => row.id === actor.activeCampusId &&
        row.organizationId === actor.orgId);
      if (!room || !campus) throw inventoryError('INVENTORY_ALLOCATION_TARGET_NOT_FOUND',
        'Room not found in the active campus.', 404);
    }
    const row = { id: randomUUID(), organizationId: actor.orgId,
      campusId: actor.activeCampusId, assetId: id, activeAssetId: id,
      staffId: data.staffId, roomId: data.roomId, allocatedOn: data.allocatedOn,
      returnedOn: null, status: 'active', allocatedBy: actor.sub, returnedBy: null,
      notes: data.notes, createdAt: now(), updatedAt: now() };
    this.assetAllocations.push(row);
    asset.status = 'allocated'; asset.activeAllocationId = row.id; asset.updatedAt = now();
    await this.inventoryAudit(actor, 'asset_allocated', 'asset_allocation', row.id, null, row);
    const userId = data.staffId && this.staff.find((staff) => staff.id === data.staffId)?.userId;
    if (userId && !this.userNotifications.some((notice) => notice.userId === userId &&
        notice.sourceType === 'inventory_asset_allocation' && notice.sourceId === row.id)) {
      this.userNotifications.unshift({ id: randomUUID(), organizationId: actor.orgId,
        campusId: actor.activeCampusId, userId, sourceType: 'inventory_asset_allocation',
        sourceId: row.id, titleEn: 'Asset allocated', titleAm: 'Asset allocated',
        bodyEn: `Asset ${asset.assetTag} was allocated to you.`,
        bodyAm: `Asset ${asset.assetTag} was allocated to you.`, readAt: null, createdAt: now() });
    }
    return structuredClone(row);
  },
  async returnFixedAsset(id, data, actor) {
    this.initInventory();
    const row = scope(this.assetAllocations, actor).find((allocation) =>
      allocation.id === id && allocation.status === 'active');
    if (!row) return null;
    const asset = scope(this.fixedAssets, actor).find((item) => item.id === row.assetId);
    const before = structuredClone(row);
    row.status = 'returned'; row.activeAssetId = null; row.returnedOn = data.returnedOn;
    row.returnedBy = actor.sub; row.updatedAt = now();
    if (asset) {
      asset.status = 'available'; asset.activeAllocationId = null; asset.updatedAt = now();
    }
    await this.inventoryAudit(actor, 'asset_returned', 'asset_allocation', id, before, row);
    return structuredClone(row);
  },
  async addAssetMaintenance(id, data, actor) {
    this.initInventory();
    if (!scope(this.fixedAssets, actor).some((asset) => asset.id === id)) return null;
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      assetId: id, ...data, createdBy: actor.sub, createdAt: now() };
    this.assetMaintenance.push(row);
    await this.inventoryAudit(actor, 'maintenance_added', 'asset_maintenance', row.id, null, row);
    return structuredClone(row);
  },
  async listAssetMaintenance(id, actor) {
    this.initInventory();
    if (!scope(this.fixedAssets, actor).some((asset) => asset.id === id)) return null;
    return scope(this.assetMaintenance, actor).filter((row) => row.assetId === id)
      .sort((a, b) => b.maintenanceOn.localeCompare(a.maintenanceOn))
      .map((row) => structuredClone(row));
  },
  async getMyAllocatedAssets(actor) {
    this.initInventory();
    const staff = this.staff.find((row) => row.userId === actor.sub &&
      row.organizationId === actor.orgId && row.campusId === actor.activeCampusId);
    if (!staff) return [];
    return scope(this.assetAllocations, actor).filter((row) =>
      row.staffId === staff.id && row.status === 'active').map((row) => ({
      ...structuredClone(row), asset: structuredClone(this.fixedAssets.find((asset) =>
        asset.id === row.assetId && asset.organizationId === actor.orgId &&
        asset.campusId === actor.activeCampusId) ?? null)
    }));
  }
};
