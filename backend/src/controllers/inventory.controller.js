export function createInventoryController(context) {
  const { parse, repo, inventoryCategorySchema, inventorySupplierSchema,
    inventoryItemSchema, inventoryPurchaseSchema, inventoryPurchaseStatusSchema,
    inventoryPurchaseUpdateSchema, inventoryReceiptSchema, inventoryMovementSchema, inventoryAssetSchema,
    inventoryAllocationSchema, inventoryReturnSchema, inventoryAssetStatusSchema,
    inventoryMaintenanceSchema, inventoryIdSchema, inventoryListQuerySchema } = context;
  const missing = (res, code, message) => res.status(404).json({ error: { code, message } });
  return {
    categories: async (req, res, next) => {
      try { res.json({ data: await repo.listInventoryCategories(req.user) }); } catch (error) { next(error); }
    },
    createCategory: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createInventoryCategory(
        parse(inventoryCategorySchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    suppliers: async (req, res, next) => {
      try { res.json({ data: await repo.listInventorySuppliers(
        parse(inventoryListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    createSupplier: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createInventorySupplier(
        parse(inventorySupplierSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    items: async (req, res, next) => {
      try { res.json({ data: await repo.listInventoryItems(
        parse(inventoryListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    createItem: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createInventoryItem(
        parse(inventoryItemSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    updateItem: async (req, res, next) => {
      try {
        const row = await repo.updateInventoryItem(parse(inventoryIdSchema, req.params.itemId),
          parse(inventoryItemSchema.partial(), req.body), req.user);
        if (!row) return missing(res, 'INVENTORY_ITEM_NOT_FOUND', 'Item not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    archiveItem: async (req, res, next) => {
      try {
        const row = await repo.archiveInventoryItem(parse(inventoryIdSchema, req.params.itemId), req.user);
        if (!row) return missing(res, 'INVENTORY_ITEM_NOT_FOUND', 'Item not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    purchases: async (req, res, next) => {
      try { res.json({ data: await repo.listInventoryPurchases(
        parse(inventoryListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    createPurchase: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createInventoryPurchase(
        parse(inventoryPurchaseSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    updatePurchase: async (req, res, next) => {
      try {
        const row = await repo.updateInventoryPurchase(
          parse(inventoryIdSchema, req.params.purchaseId),
          parse(inventoryPurchaseUpdateSchema, req.body), req.user);
        if (!row) return missing(res, 'INVENTORY_PURCHASE_NOT_FOUND', 'Purchase not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    purchaseStatus: async (req, res, next) => {
      try {
        const row = await repo.updateInventoryPurchaseStatus(
          parse(inventoryIdSchema, req.params.purchaseId),
          parse(inventoryPurchaseStatusSchema, req.body).status, req.user);
        if (!row) return missing(res, 'INVENTORY_PURCHASE_NOT_FOUND', 'Purchase not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    receivePurchase: async (req, res, next) => {
      try {
        const row = await repo.receiveInventoryPurchase(parse(inventoryIdSchema, req.params.purchaseId),
          parse(inventoryReceiptSchema, req.body), req.user);
        if (!row) return missing(res, 'INVENTORY_PURCHASE_NOT_FOUND', 'Purchase not found.');
        res.status(201).json({ data: row });
      } catch (error) { next(error); }
    },
    movements: async (req, res, next) => {
      try { res.json({ data: await repo.listInventoryMovements(
        parse(inventoryListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    createMovement: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createInventoryMovement(
        parse(inventoryMovementSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    dashboard: async (req, res, next) => {
      try { res.json({ data: await repo.getInventoryDashboard(req.user) }); } catch (error) { next(error); }
    },
    assets: async (req, res, next) => {
      try { res.json({ data: await repo.listFixedAssets(
        parse(inventoryListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    createAsset: async (req, res, next) => {
      try { res.status(201).json({ data: await repo.createFixedAsset(
        parse(inventoryAssetSchema, req.body), req.user) }); } catch (error) { next(error); }
    },
    updateAsset: async (req, res, next) => {
      try {
        const row = await repo.updateFixedAsset(parse(inventoryIdSchema, req.params.assetId),
          parse(inventoryAssetSchema.partial(), req.body), req.user);
        if (!row) return missing(res, 'INVENTORY_ASSET_NOT_FOUND', 'Asset not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    archiveAsset: async (req, res, next) => {
      try {
        const row = await repo.archiveFixedAsset(
          parse(inventoryIdSchema, req.params.assetId), req.user);
        if (!row) return missing(res, 'INVENTORY_ASSET_NOT_FOUND', 'Asset not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    assetStatus: async (req, res, next) => {
      try {
        const row = await repo.updateFixedAssetStatus(parse(inventoryIdSchema, req.params.assetId),
          parse(inventoryAssetStatusSchema, req.body), req.user);
        if (!row) return missing(res, 'INVENTORY_ASSET_NOT_FOUND', 'Asset not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    allocations: async (req, res, next) => {
      try { res.json({ data: await repo.listAssetAllocations(
        parse(inventoryListQuerySchema, req.query), req.user) }); } catch (error) { next(error); }
    },
    allocateAsset: async (req, res, next) => {
      try {
        const row = await repo.allocateFixedAsset(parse(inventoryIdSchema, req.params.assetId),
          parse(inventoryAllocationSchema, req.body), req.user);
        if (!row) return missing(res, 'INVENTORY_ASSET_NOT_FOUND', 'Asset not found.');
        res.status(201).json({ data: row });
      } catch (error) { next(error); }
    },
    returnAsset: async (req, res, next) => {
      try {
        const row = await repo.returnFixedAsset(parse(inventoryIdSchema, req.params.allocationId),
          parse(inventoryReturnSchema, req.body), req.user);
        if (!row) return missing(res, 'INVENTORY_ALLOCATION_NOT_FOUND', 'Active allocation not found.');
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    maintenance: async (req, res, next) => {
      try {
        const id = parse(inventoryIdSchema, req.params.assetId);
        const rows = await repo.listAssetMaintenance(id, req.user);
        if (rows === null) return missing(res, 'INVENTORY_ASSET_NOT_FOUND', 'Asset not found.');
        res.json({ data: rows });
      } catch (error) { next(error); }
    },
    addMaintenance: async (req, res, next) => {
      try {
        const row = await repo.addAssetMaintenance(parse(inventoryIdSchema, req.params.assetId),
          parse(inventoryMaintenanceSchema, req.body), req.user);
        if (!row) return missing(res, 'INVENTORY_ASSET_NOT_FOUND', 'Asset not found.');
        res.status(201).json({ data: row });
      } catch (error) { next(error); }
    },
    ownAssets: async (req, res, next) => {
      try { res.set('Cache-Control', 'no-store').json({ data: await repo.getMyAllocatedAssets(req.user) }); }
      catch (error) { next(error); }
    }
  };
}
