import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import InventoryPage from './InventoryPage';

vi.mock('../../api', () => ({
  api: {
    inventoryDashboard: vi.fn(),
    inventoryCategories: vi.fn(),
    inventorySuppliers: vi.fn(),
    inventoryItems: vi.fn(),
    inventoryPurchases: vi.fn(),
    inventoryMovements: vi.fn(),
    inventoryAssets: vi.fn(),
    inventoryAllocations: vi.fn(),
    myAllocatedAssets: vi.fn()
  }
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InventoryPage', () => {
  it('loads inventory management, stock, and purchase actions for an inventory manager', async () => {
    vi.mocked(api.inventoryDashboard).mockResolvedValue({
      itemCount: 1, lowStockCount: 1,
      stockValueByCurrency: [{ currencyCode: 'ETB', amountMinor: 1250 }],
      assetsAvailable: 1, assetsAllocated: 0,
      lowStockItems: [{
        id: 'item-id', categoryId: 'category-id', sku: 'PAPER-1', name: 'Paper',
        unit: 'ream', reorderLevel: 3, currentQuantity: 2, averageUnitCostMinor: 625,
        currencyCode: 'ETB', status: 'active', lowStock: true
      }]
    });
    vi.mocked(api.inventoryCategories).mockResolvedValue([{
      id: 'category-id', name: 'Supplies', status: 'active'
    }]);
    vi.mocked(api.inventorySuppliers).mockResolvedValue([]);
    vi.mocked(api.inventoryItems).mockResolvedValue([{
      id: 'item-id', categoryId: 'category-id', sku: 'PAPER-1', name: 'Paper',
      unit: 'ream', reorderLevel: 3, currentQuantity: 2, averageUnitCostMinor: 625,
      currencyCode: 'ETB', status: 'active', lowStock: true
    }]);
    vi.mocked(api.inventoryPurchases).mockResolvedValue([]);
    vi.mocked(api.inventoryMovements).mockResolvedValue([]);
    vi.mocked(api.inventoryAssets).mockResolvedValue([]);
    vi.mocked(api.inventoryAllocations).mockResolvedValue([]);

    render(<InventoryPage t={(key) => key} permissions={[
      'inventory.items.view', 'inventory.items.manage', 'inventory.purchases.manage',
      'inventory.receiving.manage', 'inventory.adjustments.manage',
      'inventory.assets.manage', 'inventory.allocations.manage'
    ]} />);

    expect(await screen.findByText('PAPER-1')).toBeTruthy();
    expect(screen.getByText('inventoryStockValue')).toBeTruthy();
    expect(screen.getAllByText('inventoryLowStock').length).toBeGreaterThan(0);
    expect(screen.getAllByText('inventoryAddItem').length).toBeGreaterThan(0);
    expect(screen.getByText('inventoryAddCategory')).toBeTruthy();
    expect(screen.getByText('inventoryAddSupplier')).toBeTruthy();
    expect(screen.getAllByText('inventoryAdjust').length).toBeGreaterThan(0);
    expect(screen.getByText('inventoryPrint')).toBeTruthy();
    await waitFor(() => expect(api.inventoryItems).toHaveBeenCalledOnce());
    expect(api.myAllocatedAssets).not.toHaveBeenCalled();
  });

  it('shows only the signed-in staff member’s allocated assets without management actions', async () => {
    vi.mocked(api.myAllocatedAssets).mockResolvedValue([{
      id: 'allocation-id', assetId: 'asset-id', staffId: 'staff-id', roomId: null,
      allocatedOn: '2026-11-01', returnedOn: null, status: 'active', notes: '',
      asset: {
        id: 'asset-id', assetTag: 'LAPTOP-1', category: 'IT', name: 'Laptop',
        purchasedOn: '2026-10-01', purchaseCostMinor: 100000, currencyCode: 'ETB',
        condition: 'good', location: 'Office', status: 'allocated', notes: ''
      }
    }]);

    render(<InventoryPage t={(key) => key} permissions={['inventory.assets.self.view']} />);

    expect(await screen.findByText('Laptop')).toBeTruthy();
    expect(screen.getByText('LAPTOP-1')).toBeTruthy();
    expect(screen.queryByText('inventoryAddItem')).toBeNull();
    expect(api.inventoryItems).not.toHaveBeenCalled();
    await waitFor(() => expect(api.myAllocatedAssets).toHaveBeenCalledOnce());
  });
});
