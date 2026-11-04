import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    myAllocatedAssets: vi.fn(),
    createInventoryPurchase: vi.fn(),
    updateInventoryPurchase: vi.fn()
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

  it('creates multi-line purchases and edits a draft purchase', async () => {
    const items = ['Paper', 'Ink'].map((name, index) => ({
      id: `item-${index}`, categoryId: 'category-id', sku: `SKU-${index}`, name,
      unit: 'each', reorderLevel: 0, currentQuantity: 0, averageUnitCostMinor: 0,
      currencyCode: 'ETB', status: 'active'
    }));
    vi.mocked(api.inventoryDashboard).mockResolvedValue({
      itemCount: 0, lowStockCount: 0, stockValueByCurrency: [],
      assetsAvailable: 0, assetsAllocated: 0, lowStockItems: []
    });
    vi.mocked(api.inventoryCategories).mockResolvedValue([]);
    vi.mocked(api.inventorySuppliers).mockResolvedValue([{
      id: 'supplier-id', name: 'School supplier', contactName: '', email: '', phone: '',
      address: '', status: 'active'
    }]);
    vi.mocked(api.inventoryItems).mockResolvedValue(items);
    vi.mocked(api.inventoryPurchases).mockResolvedValue([]);
    vi.mocked(api.inventoryMovements).mockResolvedValue([]);
    vi.mocked(api.inventoryAssets).mockResolvedValue([]);
    vi.mocked(api.inventoryAllocations).mockResolvedValue([]);
    vi.mocked(api.createInventoryPurchase).mockResolvedValue({
      id: 'purchase-id', purchaseNumber: 'PO-1', supplierId: 'supplier-id',
      purchasedOn: '2026-11-04', expectedOn: null, currencyCode: 'ETB',
      status: 'draft', lines: []
    });
    const draft = {
      id: 'purchase-id', purchaseNumber: 'PO-1', supplierId: 'supplier-id',
      purchasedOn: '2026-11-04', expectedOn: null, currencyCode: 'ETB',
      status: 'draft', lines: [
        { id: 'line-1', lineNumber: 1, itemId: items[0].id, quantity: 2, receivedQuantity: 0,
          unitCostMinor: 100, item: items[0] },
        { id: 'line-2', lineNumber: 2, itemId: items[1].id, quantity: 3, receivedQuantity: 0,
          unitCostMinor: 200, item: items[1] }
      ]
    };
    vi.mocked(api.inventoryPurchases).mockResolvedValueOnce([]).mockResolvedValueOnce([draft]);
    vi.mocked(api.updateInventoryPurchase).mockResolvedValue(draft);

    render(<InventoryPage t={(key) => key} permissions={[
      'inventory.items.view', 'inventory.items.manage', 'inventory.purchases.manage',
      'inventory.receiving.manage', 'inventory.adjustments.manage',
      'inventory.assets.manage', 'inventory.allocations.manage'
    ]} />);
    await screen.findByText('inventoryStockValue');
    fireEvent.click(screen.getByRole('tab', { name: 'inventoryPurchases' }));
    fireEvent.change(screen.getByLabelText('inventoryPurchaseNumber'), {
      target: { value: 'PO-1' }
    });
    fireEvent.change(screen.getByLabelText('inventorySuppliers'), {
      target: { value: 'supplier-id' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'inventoryAddLine' }));
    const itemSelects = screen.getAllByLabelText('inventoryItems');
    fireEvent.change(itemSelects[0], { target: { value: items[0].id } });
    fireEvent.change(itemSelects[1], { target: { value: items[1].id } });
    const quantities = screen.getAllByLabelText('inventoryQuantity');
    fireEvent.change(quantities[0], { target: { value: '2' } });
    fireEvent.change(quantities[1], { target: { value: '3' } });
    const costs = screen.getAllByLabelText('inventoryAverageCost');
    fireEvent.change(costs[0], { target: { value: '100' } });
    fireEvent.change(costs[1], { target: { value: '200' } });
    fireEvent.submit(screen.getByRole('heading', { name: 'inventoryAddPurchase' }).closest('form')!);

    await waitFor(() => expect(api.createInventoryPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ lines: [
        { itemId: items[0].id, quantity: 2, unitCostMinor: 100 },
        { itemId: items[1].id, quantity: 3, unitCostMinor: 200 }
      ] })
    ));
    fireEvent.click(await screen.findByRole('button', { name: 'edit' }));
    expect(screen.getByRole('heading', { name: 'inventoryEditPurchase' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('inventoryPurchaseNumber'), {
      target: { value: 'PO-1-EDITED' }
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'inventoryRemoveLine' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'inventoryAddLine' }));
    fireEvent.change(screen.getAllByLabelText('inventoryItems')[1], {
      target: { value: items[0].id }
    });
    fireEvent.submit(screen.getByRole('heading', { name: 'inventoryEditPurchase' }).closest('form')!);
    await waitFor(() => expect(api.updateInventoryPurchase).toHaveBeenCalledWith(
      'purchase-id', expect.objectContaining({
        purchaseNumber: 'PO-1-EDITED',
        lines: [
          { itemId: items[1].id, quantity: 3, unitCostMinor: 200 },
          { itemId: items[0].id, quantity: 1, unitCostMinor: 0 }
        ]
      })
    ));
  });

  it('shows per-line partial receipt progress and hides draft editing for ordered purchases', async () => {
    vi.mocked(api.inventoryDashboard).mockResolvedValue({
      itemCount: 0, lowStockCount: 0, stockValueByCurrency: [],
      assetsAvailable: 0, assetsAllocated: 0, lowStockItems: []
    });
    vi.mocked(api.inventoryCategories).mockResolvedValue([]);
    vi.mocked(api.inventorySuppliers).mockResolvedValue([]);
    vi.mocked(api.inventoryItems).mockResolvedValue([]);
    vi.mocked(api.inventoryPurchases).mockResolvedValue([{
      id: 'ordered-id', purchaseNumber: 'PO-ORDERED', supplierId: 'supplier-id',
      purchasedOn: '2026-11-04', expectedOn: null, currencyCode: 'ETB', status: 'ordered',
      lines: [
        { id: 'line-1', lineNumber: 1, itemId: 'item-1', quantity: 4, receivedQuantity: 2,
          unitCostMinor: 100, item: { id: 'item-1', name: 'Paper', sku: 'PAPER' } },
        { id: 'line-2', lineNumber: 2, itemId: 'item-2', quantity: 3, receivedQuantity: 0,
          unitCostMinor: 200, item: { id: 'item-2', name: 'Ink', sku: 'INK' } }
      ]
    }]);
    vi.mocked(api.inventoryMovements).mockResolvedValue([]);
    vi.mocked(api.inventoryAssets).mockResolvedValue([]);
    vi.mocked(api.inventoryAllocations).mockResolvedValue([]);

    render(<InventoryPage t={(key) => key} permissions={[
      'inventory.items.view', 'inventory.purchases.manage', 'inventory.receiving.manage'
    ]} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'inventoryPurchases' }));
    expect(screen.getByRole('progressbar', { name: 'Paper inventoryPartialReceipt' })
      .getAttribute('value')).toBe('2');
    expect(screen.getByText('Paper: 2/4 (50%)')).toBeTruthy();
    expect(screen.getByText('Ink: 0/3 (0%)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'edit' })).toBeNull();
  });
});
