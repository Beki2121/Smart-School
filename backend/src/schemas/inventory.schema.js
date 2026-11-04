import { z } from 'zod';

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const text = (max) => z.string().trim().min(1).max(max);

export const inventoryCategorySchema = z.object({ name: text(120) }).strict();
export const inventorySupplierSchema = z.object({
  name: text(180), contactName: z.string().trim().max(180).default(''),
  email: z.string().trim().max(254).default(''), phone: z.string().trim().max(40).default(''),
  address: z.string().trim().max(2000).default('')
}).strict();
export const inventoryItemSchema = z.object({
  categoryId: id, sku: text(80), name: text(180), unit: text(32),
  reorderLevel: z.number().int().min(0).max(1000000000),
  currencyCode: currency
}).strict();
export const inventoryPurchaseSchema = z.object({
  purchaseNumber: text(80), supplierId: id, purchasedOn: date, expectedOn: date.nullable().default(null),
  currencyCode: currency, notes: z.string().trim().max(4000).default(''),
  lines: z.array(z.object({
    itemId: id, quantity: z.number().int().positive().max(1000000000),
    unitCostMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  }).strict()).min(1).max(200)
}).strict();
export const inventoryPurchaseStatusSchema = z.object({
  status: z.enum(['ordered', 'cancelled'])
}).strict();
export const inventoryReceiptSchema = z.object({
  idempotencyKey: text(100), receivedOn: date,
  lines: z.array(z.object({
    purchaseLineId: id, quantity: z.number().int().positive().max(1000000000)
  }).strict()).min(1).max(200)
}).strict();
export const inventoryMovementSchema = z.object({
  itemId: id, movementType: z.enum(['in', 'out', 'adjustment']),
  quantity: z.number().int().min(-1000000000).max(1000000000).refine((value) => value !== 0),
  unitCostMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  movedOn: date, reason: text(500), idempotencyKey: text(100).optional()
}).strict();
export const inventoryAssetSchema = z.object({
  assetTag: text(80), category: text(120), name: text(180), purchasedOn: date,
  purchaseCostMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currencyCode: currency, condition: z.enum(['new', 'good', 'fair', 'poor', 'lost', 'disposed']).default('good'),
  location: z.string().trim().max(180).default(''), notes: z.string().trim().max(4000).default('')
}).strict();
export const inventoryAllocationSchema = z.object({
  staffId: id.nullable().default(null), roomId: id.nullable().default(null),
  allocatedOn: date, notes: z.string().trim().max(2000).default('')
}).strict().refine((value) => Number(Boolean(value.staffId)) + Number(Boolean(value.roomId)) === 1,
  'Select exactly one staff member or room.');
export const inventoryReturnSchema = z.object({ returnedOn: date }).strict();
export const inventoryAssetStatusSchema = z.object({
  status: z.enum(['lost', 'disposed']), reason: text(500), changedOn: date
}).strict();
export const inventoryMaintenanceSchema = z.object({
  maintenanceOn: date, note: text(2000),
  costMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  currencyCode: currency
}).strict();
export const inventoryIdSchema = id;
export const inventoryListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().max(24).optional(),
  categoryId: id.optional(), supplierId: id.optional(), itemId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
}).strict();
