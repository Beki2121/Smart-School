import { createInventoryController } from '../controllers/inventory.controller.js';

const routes = {
  categories(app, c, x) { app.get('/api/inventory/categories', c.requirePermission('inventory.items.view'), x.categories); },
  createCategory(app, c, x) { app.post('/api/inventory/categories', c.requirePermission('inventory.items.manage'), x.createCategory); },
  suppliers(app, c, x) { app.get('/api/inventory/suppliers', c.requirePermission('inventory.purchases.manage'), x.suppliers); },
  createSupplier(app, c, x) { app.post('/api/inventory/suppliers', c.requirePermission('inventory.purchases.manage'), x.createSupplier); },
  items(app, c, x) { app.get('/api/inventory/items', c.requirePermission('inventory.items.view'), x.items); },
  createItem(app, c, x) { app.post('/api/inventory/items', c.requirePermission('inventory.items.manage'), x.createItem); },
  updateItem(app, c, x) { app.patch('/api/inventory/items/:itemId', c.requirePermission('inventory.items.manage'), x.updateItem); },
  archiveItem(app, c, x) { app.post('/api/inventory/items/:itemId/archive', c.requirePermission('inventory.items.manage'), x.archiveItem); },
  purchases(app, c, x) { app.get('/api/inventory/purchases', c.requirePermission('inventory.purchases.manage'), x.purchases); },
  createPurchase(app, c, x) { app.post('/api/inventory/purchases', c.requirePermission('inventory.purchases.manage'), x.createPurchase); },
  updatePurchase(app, c, x) { app.patch('/api/inventory/purchases/:purchaseId', c.requirePermission('inventory.purchases.manage'), x.updatePurchase); },
  purchaseStatus(app, c, x) { app.post('/api/inventory/purchases/:purchaseId/status', c.requirePermission('inventory.purchases.manage'), x.purchaseStatus); },
  receivePurchase(app, c, x) { app.post('/api/inventory/purchases/:purchaseId/receipts', c.requirePermission('inventory.receiving.manage'), x.receivePurchase); },
  movements(app, c, x) { app.get('/api/inventory/movements', c.requirePermission('inventory.items.view'), x.movements); },
  createMovement(app, c, x) { app.post('/api/inventory/movements', c.requirePermission('inventory.adjustments.manage'), x.createMovement); },
  dashboard(app, c, x) { app.get('/api/inventory/dashboard', c.requirePermission('inventory.items.view'), x.dashboard); },
  assets(app, c, x) { app.get('/api/inventory/assets', c.requirePermission('inventory.assets.manage'), x.assets); },
  createAsset(app, c, x) { app.post('/api/inventory/assets', c.requirePermission('inventory.assets.manage'), x.createAsset); },
  updateAsset(app, c, x) { app.patch('/api/inventory/assets/:assetId', c.requirePermission('inventory.assets.manage'), x.updateAsset); },
  archiveAsset(app, c, x) { app.post('/api/inventory/assets/:assetId/archive', c.requirePermission('inventory.assets.manage'), x.archiveAsset); },
  assetStatus(app, c, x) { app.post('/api/inventory/assets/:assetId/status', c.requirePermission('inventory.assets.manage'), x.assetStatus); },
  allocations(app, c, x) { app.get('/api/inventory/allocations', c.requirePermission('inventory.allocations.manage'), x.allocations); },
  allocateAsset(app, c, x) { app.post('/api/inventory/assets/:assetId/allocations', c.requirePermission('inventory.allocations.manage'), x.allocateAsset); },
  returnAsset(app, c, x) { app.post('/api/inventory/allocations/:allocationId/return', c.requirePermission('inventory.allocations.manage'), x.returnAsset); },
  maintenance(app, c, x) { app.get('/api/inventory/assets/:assetId/maintenance', c.requirePermission('inventory.assets.manage'), x.maintenance); },
  addMaintenance(app, c, x) { app.post('/api/inventory/assets/:assetId/maintenance', c.requirePermission('inventory.assets.manage'), x.addMaintenance); },
  ownAssets(app, c, x) { app.get('/api/inventory/my-assets', c.requirePermission('inventory.assets.self.view'), x.ownAssets); }
};

export function registerInventoryRoutes(app, context, routeIds) {
  const controller = createInventoryController(context);
  for (const routeId of routeIds) routes[routeId](app, context, controller);
}
