import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, AssetAllocation, FixedAsset, InventoryCategory, InventoryDashboard,
  InventoryItem, InventoryMovement, InventoryPurchase, InventorySupplier } from '../../api';

type T = (key: string) => string;
type Props = { t: T; permissions: string[] };
type PurchaseLineDraft = { itemId: string; quantity: string; unitCostMinor: string };
type PurchaseDraft = {
  purchaseNumber: string; supplierId: string; purchasedOn: string;
  expectedOn: string; currencyCode: string; notes: string; lines: PurchaseLineDraft[]
};
const today = () => new Date().toISOString().slice(0, 10);
const idempotencyKey = () => crypto.randomUUID();
const emptyPurchaseDraft = (): PurchaseDraft => ({
  purchaseNumber: '', supplierId: '', purchasedOn: today(), expectedOn: '',
  currencyCode: 'ETB', notes: '',
  lines: [{ itemId: '', quantity: '1', unitCostMinor: '0' }]
});

export default function InventoryPage({ t, permissions }: Props) {
  const can = (permission: string) => permissions.includes(permission);
  const manager = can('inventory.items.view');
  const [dashboard, setDashboard] = useState<InventoryDashboard>({
    itemCount: 0, lowStockCount: 0, stockValueByCurrency: [],
    assetsAvailable: 0, assetsAllocated: 0, lowStockItems: []
  });
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [suppliers, setSuppliers] = useState<InventorySupplier[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<InventoryPurchase[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [allocations, setAllocations] = useState<AssetAllocation[]>([]);
  const [myAssets, setMyAssets] = useState<AssetAllocation[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'stock' | 'purchases' | 'assets' | 'movements'>('stock');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [itemEditId, setItemEditId] = useState('');
  const [itemDraft, setItemDraft] = useState({
    categoryId: '', sku: '', name: '', unit: 'each', reorderLevel: '0', currencyCode: 'ETB'
  });
  const [movementDraft, setMovementDraft] = useState({
    itemId: '', movementType: 'out' as 'in' | 'out' | 'adjustment',
    quantity: '1', unitCostMinor: '0', reason: '', movedOn: today()
  });
  const [purchaseEditId, setPurchaseEditId] = useState('');
  const [purchaseDraft, setPurchaseDraft] = useState<PurchaseDraft>(emptyPurchaseDraft);
  const [assetDraft, setAssetDraft] = useState({
    assetTag: '', category: '', name: '', purchasedOn: today(), purchaseCostMinor: '0',
    currencyCode: 'ETB', condition: 'good', location: '', notes: ''
  });
  const [assetEditId, setAssetEditId] = useState('');
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, {
    staffId: string; roomId: string
  }>>({});
  const [maintenanceDraft, setMaintenanceDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!manager) {
      setMyAssets(await api.myAllocatedAssets());
      return;
    }
    const jobs: Promise<void>[] = [
      api.inventoryDashboard().then(setDashboard),
      api.inventoryCategories().then(setCategories),
      api.inventorySuppliers({ search }).then(setSuppliers),
      api.inventoryItems({ search }).then(setItems),
      api.inventoryPurchases({ search }).then(setPurchases),
      api.inventoryMovements({ search }).then(setMovements),
      api.inventoryAssets({ search }).then(setAssets),
      api.inventoryAllocations('active').then(setAllocations)
    ];
    await Promise.all(jobs);
  }, [manager, search]);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t('apiError')));
  }, [load, t]);

  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); setNotice(t('inventorySaved')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent, action: () => Promise<unknown>) {
    event.preventDefault();
    void perform(action);
  }
  async function exportReport(reportId: string) {
    try {
      const blob = await api.exportReport(reportId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${reportId}.csv`; link.click();
      URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('apiError')); }
  }
  function editItem(item: InventoryItem) {
    setItemEditId(item.id);
    setItemDraft({ categoryId: item.categoryId, sku: item.sku, name: item.name, unit: item.unit,
      reorderLevel: String(item.reorderLevel), currencyCode: item.currencyCode });
  }
  function editAsset(asset: FixedAsset) {
    setAssetEditId(asset.id);
    setAssetDraft({
      assetTag: asset.assetTag, category: asset.category, name: asset.name,
      purchasedOn: asset.purchasedOn, purchaseCostMinor: String(asset.purchaseCostMinor),
      currencyCode: asset.currencyCode, condition: asset.condition, location: asset.location,
      notes: asset.notes
    });
  }
  function editPurchase(purchase: InventoryPurchase) {
    setPurchaseEditId(purchase.id);
    setPurchaseDraft({
      purchaseNumber: purchase.purchaseNumber, supplierId: purchase.supplierId,
      purchasedOn: purchase.purchasedOn, expectedOn: purchase.expectedOn ?? '',
      currencyCode: purchase.currencyCode, notes: purchase.notes ?? '',
      lines: purchase.lines.map((line) => ({
        itemId: line.itemId, quantity: String(line.quantity),
        unitCostMinor: String(line.unitCostMinor)
      }))
    });
  }
  function updatePurchaseLine(index: number, patch: Partial<PurchaseLineDraft>) {
    setPurchaseDraft((current) => ({
      ...current, lines: current.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line)
    }));
  }
  function resetPurchaseDraft() {
    setPurchaseEditId('');
    setPurchaseDraft(emptyPurchaseDraft());
  }
  async function savePurchase(event: FormEvent) {
    event.preventDefault();
    const body = {
      purchaseNumber: purchaseDraft.purchaseNumber, supplierId: purchaseDraft.supplierId,
      purchasedOn: purchaseDraft.purchasedOn, expectedOn: purchaseDraft.expectedOn || null,
      currencyCode: purchaseDraft.currencyCode, notes: purchaseDraft.notes,
      lines: purchaseDraft.lines.map((line) => ({
        itemId: line.itemId, quantity: Number(line.quantity),
        unitCostMinor: Number(line.unitCostMinor)
      }))
    };
    await perform(async () => {
      if (purchaseEditId) await api.updateInventoryPurchase(purchaseEditId, body);
      else await api.createInventoryPurchase(body);
      resetPurchaseDraft();
    });
  }
  async function saveAsset(event: FormEvent) {
    event.preventDefault();
    const body = { ...assetDraft, purchaseCostMinor: Number(assetDraft.purchaseCostMinor) };
    await perform(async () => {
      if (assetEditId) await api.updateFixedAsset(assetEditId, body);
      else await api.createFixedAsset(body);
      setAssetEditId('');
      setAssetDraft({ assetTag: '', category: '', name: '', purchasedOn: today(),
        purchaseCostMinor: '0', currencyCode: 'ETB', condition: 'good', location: '', notes: '' });
    });
  }
  async function saveItem(event: FormEvent) {
    event.preventDefault();
    const body = { ...itemDraft, reorderLevel: Number(itemDraft.reorderLevel) };
    await perform(async () => {
      if (itemEditId) await api.updateInventoryItem(itemEditId, body);
      else await api.createInventoryItem(body);
      setItemEditId('');
      setItemDraft({ categoryId: '', sku: '', name: '', unit: 'each', reorderLevel: '0', currencyCode: 'ETB' });
    });
  }

  if (!manager) return <section className="page-section">
    <header className="section-heading"><div><h1>{t('navInventory')}</h1>
      <p>{t('inventoryHint')}</p></div></header>
    {error && <div role="alert" className="form-error">{error}</div>}
    <h2>{t('inventoryAssets')}</h2>
    {!myAssets.length ? <div className="empty-state">{t('emptyState')}</div> :
      <div className="table-scroll"><table><thead><tr><th>{t('inventoryAssetTag')}</th>
        <th>{t('inventoryAssetName')}</th><th>{t('inventoryLocation')}</th><th>{t('inventoryAllocationDate')}</th>
      </tr></thead><tbody>{myAssets.map((row) => <tr key={row.id}>
        <td>{row.asset?.assetTag}</td><td>{row.asset?.name}</td><td>{row.asset?.location}</td>
        <td>{row.allocatedOn}</td></tr>)}</tbody></table></div>}
  </section>;

  return <section className="page-section inventory-page">
    <header className="section-heading">
      <div><h1>{t('navInventory')}</h1><p>{t('inventoryHint')}</p></div>
      <div className="section-actions">
        <button type="button" onClick={() => window.print()}>{t('inventoryPrint')}</button>
        <button type="button" onClick={() => void exportReport('inventory-stock-valuation')}>{t('inventoryStockReport')}</button>
        <button type="button" onClick={() => void exportReport('inventory-movements')}>{t('inventoryMovementReport')}</button>
        <button type="button" onClick={() => void exportReport('inventory-assets')}>{t('inventoryAssetReport')}</button>
      </div>
    </header>
    {error && <div role="alert" className="form-error">{error}</div>}
    {notice && <div role="status" className="form-success">{notice}</div>}
    <div className="stats-grid">
      <article className="stat-card"><span>{t('inventoryItems')}</span><strong>{dashboard.itemCount}</strong></article>
      <article className="stat-card"><span>{t('inventoryLowStock')}</span><strong>{dashboard.lowStockCount}</strong></article>
      <article className="stat-card"><span>{t('inventoryStockValue')}</span>
        <strong>{dashboard.stockValueByCurrency.length
          ? dashboard.stockValueByCurrency.map((value) =>
            `${value.currencyCode} ${value.amountMinor}`).join(' · ')
          : '—'}</strong></article>
      <article className="stat-card"><span>{t('inventoryAssets')}</span><strong>{dashboard.assetsAvailable + dashboard.assetsAllocated}</strong></article>
    </div>
    {dashboard.lowStockItems.length > 0 && <div className="notice-card">
      <strong>{t('inventoryLowStock')}</strong>
      <ul>{dashboard.lowStockItems.map((item) => <li key={item.id}>
        {item.name}: {item.currentQuantity} {item.unit} · {t('inventoryReorderLevel')} {item.reorderLevel}
      </li>)}</ul>
    </div>}
    <div className="filter-bar">
      <label>{t('inventorySearch')}<input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="tab-buttons" role="tablist">
        {(['stock', 'purchases', 'assets', 'movements'] as const).map((value) =>
          <button type="button" role="tab" aria-selected={tab === value} key={value}
            onClick={() => setTab(value)}>{t(value === 'stock' ? 'inventoryItems' :
              value === 'purchases' ? 'inventoryPurchases' :
                value === 'assets' ? 'inventoryAssets' : 'inventoryMovements')}</button>)}
      </div>
    </div>

    {tab === 'stock' && <>
      <div className="panel-grid">
        <form className="form-card" onSubmit={(event) => void saveItem(event)}>
          <h2>{t('inventoryAddItem')}</h2>
          <label>{t('inventoryCategories')}<select required value={itemDraft.categoryId}
            onChange={(event) => setItemDraft({ ...itemDraft, categoryId: event.target.value })}>
            <option value="">—</option>{categories.map((row) =>
              <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <div className="form-grid">
            <label>{t('inventorySku')}<input required value={itemDraft.sku}
              onChange={(event) => setItemDraft({ ...itemDraft, sku: event.target.value })} /></label>
            <label>{t('inventoryItemName')}<input required value={itemDraft.name}
              onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} /></label>
            <label>{t('inventoryUnit')}<input required value={itemDraft.unit}
              onChange={(event) => setItemDraft({ ...itemDraft, unit: event.target.value })} /></label>
            <label>{t('inventoryReorderLevel')}<input type="number" min="0" required
              value={itemDraft.reorderLevel} onChange={(event) =>
                setItemDraft({ ...itemDraft, reorderLevel: event.target.value })} /></label>
            <label>{t('inventoryCurrency')}<input maxLength={3} required value={itemDraft.currencyCode}
              onChange={(event) => setItemDraft({ ...itemDraft, currencyCode: event.target.value.toUpperCase() })} /></label>
          </div>
          <button disabled={busy} type="submit">{itemEditId ? t('save') : t('inventoryAddItem')}</button>
          {itemEditId && <button type="button" onClick={() => setItemEditId('')}>{t('cancel')}</button>}
        </form>
        <div className="form-card">
          <h2>{t('inventoryCategories')} &amp; {t('inventorySuppliers')}</h2>
          <form onSubmit={(event) => submit(event, async () => {
            await api.createInventoryCategory({ name: categoryName }); setCategoryName('');
          })}>
            <label>{t('inventoryCategories')}<input required value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)} /></label>
            <button disabled={busy}>{t('inventoryAddCategory')}</button>
          </form>
          <form onSubmit={(event) => submit(event, async () => {
            await api.createInventorySupplier({ name: supplierName, contactName: '',
              email: '', phone: '', address: '' }); setSupplierName('');
          })}>
            <label>{t('inventorySupplierName')}<input required value={supplierName}
              onChange={(event) => setSupplierName(event.target.value)} /></label>
            <button disabled={busy}>{t('inventoryAddSupplier')}</button>
          </form>
          <p>{suppliers.map((supplier) => supplier.name).join(', ')}</p>
        </div>
      </div>
      <form className="form-card" onSubmit={(event) => submit(event, () =>
        api.createInventoryMovement({
          itemId: movementDraft.itemId, movementType: movementDraft.movementType,
          quantity: Number(movementDraft.quantity), unitCostMinor: Number(movementDraft.unitCostMinor),
          movedOn: movementDraft.movedOn, reason: movementDraft.reason,
          idempotencyKey: idempotencyKey()
        }))}>
        <h2>{t('inventoryAdjust')}</h2>
        <div className="form-grid">
          <label>{t('inventoryItems')}<select required value={movementDraft.itemId}
            onChange={(event) => setMovementDraft({ ...movementDraft, itemId: event.target.value })}>
            <option value="">—</option>{items.map((item) =>
              <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label>
          <label>{t('inventoryMovementType')}<select value={movementDraft.movementType}
            onChange={(event) => setMovementDraft({ ...movementDraft,
              movementType: event.target.value as 'in' | 'out' | 'adjustment' })}>
            <option value="in">in</option><option value="out">out</option><option value="adjustment">adjustment</option>
          </select></label>
          <label>{t('inventoryQuantity')}<input type="number" required value={movementDraft.quantity}
            onChange={(event) => setMovementDraft({ ...movementDraft, quantity: event.target.value })} /></label>
          <label>{t('inventoryAverageCost')}<input type="number" min="0" value={movementDraft.unitCostMinor}
            onChange={(event) => setMovementDraft({ ...movementDraft, unitCostMinor: event.target.value })} /></label>
          <label>{t('inventoryDate')}<input type="date" required value={movementDraft.movedOn}
            onChange={(event) => setMovementDraft({ ...movementDraft, movedOn: event.target.value })} /></label>
          <label>{t('inventoryReason')}<input required value={movementDraft.reason}
            onChange={(event) => setMovementDraft({ ...movementDraft, reason: event.target.value })} /></label>
        </div><button disabled={busy}>{t('inventoryAdjust')}</button>
      </form>
      <div className="table-scroll"><table><thead><tr><th>{t('inventorySku')}</th>
        <th>{t('inventoryItemName')}</th><th>{t('inventoryCategories')}</th><th>{t('inventoryQuantity')}</th>
        <th>{t('inventoryUnit')}</th><th>{t('inventoryReorderLevel')}</th><th>{t('inventoryAverageCost')}</th>
        <th>{t('actions')}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
          <td>{item.sku}</td><td>{item.name}</td><td>{categories.find((category) => category.id === item.categoryId)?.name}</td>
          <td>{item.currentQuantity}{item.lowStock && <strong className="status-pill">{t('inventoryLowStock')}</strong>}</td>
          <td>{item.unit}</td><td>{item.reorderLevel}</td><td>{item.averageUnitCostMinor}</td>
          <td><button type="button" onClick={() => editItem(item)}>{t('edit')}</button>
            <button type="button" disabled={busy || item.currentQuantity !== 0}
              onClick={() => void perform(() => api.archiveInventoryItem(item.id))}>{t('archive')}</button></td>
        </tr>)}</tbody></table></div>
    </>}

    {tab === 'purchases' && <>
      <form className="form-card" onSubmit={(event) => void savePurchase(event)}>
        <h2>{t(purchaseEditId ? 'inventoryEditPurchase' : 'inventoryAddPurchase')}</h2><div className="form-grid">
          <label>{t('inventoryPurchaseNumber')}<input required value={purchaseDraft.purchaseNumber}
            onChange={(event) => setPurchaseDraft({ ...purchaseDraft, purchaseNumber: event.target.value })} /></label>
          <label>{t('inventorySuppliers')}<select required value={purchaseDraft.supplierId}
            onChange={(event) => setPurchaseDraft({ ...purchaseDraft, supplierId: event.target.value })}>
            <option value="">—</option>{suppliers.map((supplier) =>
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label>{t('inventoryPurchasedOn')}<input type="date" required value={purchaseDraft.purchasedOn}
            onChange={(event) => setPurchaseDraft({ ...purchaseDraft, purchasedOn: event.target.value })} /></label>
          <label>{t('inventoryExpectedOn')}<input type="date" value={purchaseDraft.expectedOn}
            onChange={(event) => setPurchaseDraft({ ...purchaseDraft, expectedOn: event.target.value })} /></label>
          <label>{t('inventoryCurrency')}<input required maxLength={3} value={purchaseDraft.currencyCode}
            onChange={(event) => setPurchaseDraft({ ...purchaseDraft,
              currencyCode: event.target.value.toUpperCase() })} /></label>
        </div>
        <h3>{t('inventoryPurchaseLines')}</h3>
        {purchaseDraft.lines.map((line, index) => <div className="form-grid" key={`purchase-line-${index}`}>
          <label>{t('inventoryItems')}<select required value={line.itemId}
            onChange={(event) => updatePurchaseLine(index, { itemId: event.target.value })}>
            <option value="">—</option>{items.map((item) =>
              <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label>
          <label>{t('inventoryQuantity')}<input type="number" min="1" step="1" required
            value={line.quantity} onChange={(event) =>
              updatePurchaseLine(index, { quantity: event.target.value })} /></label>
          <label>{t('inventoryAverageCost')}<input type="number" min="0" step="1" required
            value={line.unitCostMinor} onChange={(event) =>
              updatePurchaseLine(index, { unitCostMinor: event.target.value })} /></label>
          {purchaseDraft.lines.length > 1 && <button type="button" disabled={busy}
            onClick={() => setPurchaseDraft((current) => ({
              ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index)
            }))}>{t('inventoryRemoveLine')}</button>}
        </div>)}
        <div className="section-actions">
          <button type="button" disabled={busy} onClick={() =>
            setPurchaseDraft((current) => ({ ...current, lines: [
              ...current.lines, { itemId: '', quantity: '1', unitCostMinor: '0' }
            ] }))}>{t('inventoryAddLine')}</button>
          <button disabled={busy}>{t(purchaseEditId ? 'save' : 'inventoryAddPurchase')}</button>
          {purchaseEditId && <button type="button" disabled={busy}
            onClick={resetPurchaseDraft}>{t('cancel')}</button>}
        </div>
      </form>
      <div className="table-scroll"><table><thead><tr><th>{t('inventoryPurchaseNumber')}</th>
        <th>{t('inventorySuppliers')}</th><th>{t('inventoryPurchasedOn')}</th><th>{t('status')}</th>
        <th>{t('inventoryItems')}</th><th>{t('actions')}</th></tr></thead><tbody>
        {purchases.map((purchase) => <tr key={purchase.id}><td>{purchase.purchaseNumber}</td>
          <td>{purchase.supplier?.name}</td><td>{purchase.purchasedOn}</td><td>{purchase.status}</td>
          <td>          {purchase.lines.map((line) => {
            const percent = Math.floor(line.receivedQuantity / line.quantity * 100);
            return <div key={line.id}>
              <span>{line.item?.name}: {line.receivedQuantity}/{line.quantity} ({percent}%)</span>
              <progress aria-label={`${line.item?.name} ${t('inventoryPartialReceipt')}`}
                value={line.receivedQuantity} max={line.quantity} />
            </div>;
          })}</td>
          <td>{purchase.status === 'draft' && <button disabled={busy} onClick={() =>
            editPurchase(purchase)}>{t('edit')}</button>}
            {purchase.status === 'draft' && <button disabled={busy} onClick={() =>
              void perform(() => api.setInventoryPurchaseStatus(purchase.id, 'ordered'))}>{t('inventoryOrder')}</button>}
            {['ordered', 'partially_received'].includes(purchase.status) &&
              <button disabled={busy} onClick={() => {
                const line = purchase.lines.find((item) => item.quantity > item.receivedQuantity);
                if (!line) return;
                const quantity = window.prompt(`${t('inventoryReceive')} (${line.item?.name})`,
                  String(line.quantity - line.receivedQuantity));
                if (quantity === null) return;
                void perform(() => api.receiveInventoryPurchase(purchase.id, {
                  idempotencyKey: idempotencyKey(), receivedOn: today(),
                  lines: [{ purchaseLineId: line.id, quantity: Number(quantity) }]
                }));
              }}>{t('inventoryReceive')}</button>}</td>
        </tr>)}</tbody></table></div>
    </>}

    {tab === 'assets' && <>
      <form className="form-card" onSubmit={(event) => void saveAsset(event)}>
        <h2>{t('inventoryAddAsset')}</h2><div className="form-grid">
          <label>{t('inventoryAssetTag')}<input required value={assetDraft.assetTag}
            onChange={(event) => setAssetDraft({ ...assetDraft, assetTag: event.target.value })} /></label>
          <label>{t('inventoryAssetName')}<input required value={assetDraft.name}
            onChange={(event) => setAssetDraft({ ...assetDraft, name: event.target.value })} /></label>
          <label>{t('inventoryAssetCategory')}<input required value={assetDraft.category}
            onChange={(event) => setAssetDraft({ ...assetDraft, category: event.target.value })} /></label>
          <label>{t('inventoryPurchasedOn')}<input type="date" required value={assetDraft.purchasedOn}
            onChange={(event) => setAssetDraft({ ...assetDraft, purchasedOn: event.target.value })} /></label>
          <label>{t('inventoryPurchaseCost')}<input type="number" min="0" required
            value={assetDraft.purchaseCostMinor} onChange={(event) =>
              setAssetDraft({ ...assetDraft, purchaseCostMinor: event.target.value })} /></label>
          <label>{t('inventoryCurrency')}<input required maxLength={3} value={assetDraft.currencyCode}
            onChange={(event) => setAssetDraft({ ...assetDraft,
              currencyCode: event.target.value.toUpperCase() })} /></label>
          <label>{t('inventoryCondition')}<select value={assetDraft.condition}
            onChange={(event) => setAssetDraft({ ...assetDraft, condition: event.target.value })}>
            {['new', 'good', 'fair', 'poor'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>{t('inventoryLocation')}<input value={assetDraft.location}
            onChange={(event) => setAssetDraft({ ...assetDraft, location: event.target.value })} /></label>
        </div><button disabled={busy}>{assetEditId ? t('save') : t('inventoryAddAsset')}</button>
        {assetEditId && <button type="button" onClick={() => setAssetEditId('')}>{t('cancel')}</button>}
      </form>
      <div className="table-scroll"><table><thead><tr><th>{t('inventoryAssetTag')}</th>
        <th>{t('inventoryAssetName')}</th><th>{t('inventoryAssetCategory')}</th><th>{t('inventoryCondition')}</th>
        <th>{t('inventoryLocation')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead><tbody>
        {assets.map((asset) => {
          const allocation = allocations.find((row) => row.assetId === asset.id);
          const draft = allocationDrafts[asset.id] ?? { staffId: '', roomId: '' };
          return <tr key={asset.id}><td>{asset.assetTag}</td><td>{asset.name}</td>
            <td>{asset.category}</td><td>{asset.condition}</td><td>{asset.location}</td><td>{asset.status}</td>
            <td>{!allocation && asset.status !== 'lost' && asset.status !== 'disposed' &&
              <button type="button" onClick={() => editAsset(asset)}>{t('edit')}</button>}
              {!allocation && <button type="button" disabled={busy} onClick={() =>
                void perform(() => api.archiveFixedAsset(asset.id))}>{t('archive')}</button>}
              {asset.status === 'available' && <form onSubmit={(event) => submit(event, () =>
              api.allocateFixedAsset(asset.id, { staffId: draft.staffId || null,
                roomId: draft.roomId || null, allocatedOn: today(), notes: '' }))}>
              <label>{t('inventoryStaffId')}<input value={draft.staffId}
                onChange={(event) => setAllocationDrafts({ ...allocationDrafts,
                  [asset.id]: { ...draft, staffId: event.target.value, roomId: '' } })} /></label>
              <label>{t('inventoryRoomId')}<input value={draft.roomId}
                onChange={(event) => setAllocationDrafts({ ...allocationDrafts,
                  [asset.id]: { ...draft, roomId: event.target.value, staffId: '' } })} /></label>
              <button disabled={busy}>{t('inventoryAllocate')}</button></form>}
              {allocation && <button disabled={busy} onClick={() =>
                void perform(() => api.returnFixedAsset(allocation.id, today()))}>{t('inventoryReturn')}</button>}
              {asset.status === 'available' && <><button disabled={busy} onClick={() =>
                void perform(() => api.setFixedAssetStatus(asset.id,
                  { status: 'lost', reason: 'Marked lost by inventory staff', changedOn: today() }))}>
                {t('inventoryMarkLost')}</button><button disabled={busy} onClick={() =>
                void perform(() => api.setFixedAssetStatus(asset.id,
                  { status: 'disposed', reason: 'Disposed by inventory staff', changedOn: today() }))}>
                {t('inventoryDispose')}</button></>}
              <form onSubmit={(event) => submit(event, () => api.addAssetMaintenance(asset.id, {
                maintenanceOn: today(), note: maintenanceDraft[asset.id] ?? '',
                costMinor: 0, currencyCode: asset.currencyCode
              }))}><label>{t('inventoryMaintenanceNote')}<input required
                value={maintenanceDraft[asset.id] ?? ''} onChange={(event) =>
                  setMaintenanceDraft({ ...maintenanceDraft, [asset.id]: event.target.value })} /></label>
                <button disabled={busy}>{t('inventoryAddMaintenance')}</button></form>
            </td></tr>;
        })}</tbody></table></div>
    </>}

    {tab === 'movements' && <div className="table-scroll"><table><thead><tr>
      <th>{t('inventoryDate')}</th><th>{t('inventorySku')}</th><th>{t('inventoryItemName')}</th>
      <th>{t('inventoryMovementType')}</th><th>{t('inventoryQuantity')}</th>
      <th>{t('inventoryReason')}</th></tr></thead><tbody>
      {movements.map((movement) => <tr key={movement.id}><td>{movement.movedOn}</td>
        <td>{movement.item?.sku}</td><td>{movement.item?.name}</td><td>{movement.movementType}</td>
        <td>{movement.quantityDelta} → {movement.quantityAfter}</td><td>{movement.reason}</td></tr>)}
    </tbody></table></div>}
  </section>;
}
