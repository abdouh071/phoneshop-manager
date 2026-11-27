import {
  clampStock,
  deriveStockStatus,
  profileTotalsAfter,
  saleProfileDeltas,
} from './offlineQueuePolicy.ts';

export interface TxRef {
  path: string;
  id: string;
}

export interface TxSnapshot {
  exists: () => boolean;
  data: () => Record<string, unknown> | undefined;
}

export interface FirestoreTxOps {
  doc: (col: string, id: string) => TxRef;
  get: (ref: TxRef) => Promise<TxSnapshot>;
  update: (ref: TxRef, data: Record<string, unknown>) => void;
  set: (ref: TxRef, data: Record<string, unknown>) => void;
}

export type StockCollectionName = 'inventory' | 'products';

export interface CoreStockLine {
  productId: string;
  name: string;
  quantity: number;
}

export interface CorePartsDelta {
  productId: string;
  name: string;
  delta: number;
}

export interface CoreAppliedStock {
  line: CoreStockLine;
  collection: StockCollectionName;
  previousStock: number;
  stock: number;
  stockStatus: 'out_of_stock' | 'low_stock' | 'in_stock';
}

interface ResolvedStockDoc {
  ref: TxRef;
  collection: StockCollectionName;
  data: Record<string, unknown>;
}

const isSaleStatusClosed = (status: unknown): boolean =>
  status === 'voided' || status === 'refunded' || status === 'cancelled';

/**
 * Resolves all unique product documents (`inventory` first, `products` fallback)
 * up front so all transaction reads occur before any transaction write.
 */
async function resolveStockDocsInTx(
  ops: FirestoreTxOps,
  productIds: string[]
): Promise<Map<string, ResolvedStockDoc | null>> {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  const resolved = new Map<string, ResolvedStockDoc | null>();

  for (const productId of uniqueIds) {
    const invRef = ops.doc('inventory', productId);
    const invSnap = await ops.get(invRef);
    if (invSnap.exists()) {
      resolved.set(productId, {
        ref: invRef,
        collection: 'inventory',
        data: invSnap.data() ?? {},
      });
      continue;
    }

    const prodRef = ops.doc('products', productId);
    const prodSnap = await ops.get(prodRef);
    if (prodSnap.exists()) {
      resolved.set(productId, {
        ref: prodRef,
        collection: 'products',
        data: prodSnap.data() ?? {},
      });
      continue;
    }

    resolved.set(productId, null);
  }

  return resolved;
}

function groupPositiveLines(lines: CoreStockLine[]): {
  grouped: Map<string, { name: string; quantity: number }>;
  invalid: { line: CoreStockLine; error: string }[];
} {
  const grouped = new Map<string, { name: string; quantity: number }>();
  const invalid: { line: CoreStockLine; error: string }[] = [];

  for (const line of lines) {
    const quantity = Math.trunc(Number(line.quantity) || 0);
    if (!line.productId) {
      invalid.push({ line, error: 'missing product id' });
      continue;
    }
    if (quantity <= 0) continue;
    const prev = grouped.get(line.productId);
    grouped.set(line.productId, {
      name: prev?.name || line.name,
      quantity: (prev?.quantity || 0) + quantity,
    });
  }

  return { grouped, invalid };
}

export async function runPartsAllocationTx(
  ops: FirestoreTxOps,
  params: {
    ticketId: string;
    actionId: string;
    deltas: CorePartsDelta[];
    fields: { partsUsed: unknown[]; updatedAt: string };
  }
): Promise<{
  applied: CorePartsDelta[];
  failed: { delta: CorePartsDelta; error: string }[];
  adopted: boolean;
}> {
  const ticketRef = ops.doc('repairs', params.ticketId);
  const ticketSnap = await ops.get(ticketRef);
  if (!ticketSnap.exists()) throw new Error(`Ticket ${params.ticketId} no longer exists`);

  const current = ticketSnap.data() ?? {};
  if (current.lastPartsActionId === params.actionId) {
    return { applied: [], failed: [], adopted: true };
  }

  const stockDocs = await resolveStockDocsInTx(
    ops,
    params.deltas.map((d) => d.productId)
  );

  const applied: CorePartsDelta[] = [];
  const failed: { delta: CorePartsDelta; error: string }[] = [];
  const pendingWrites: { ref: TxRef; stock: number; stockStatus: string; delta: CorePartsDelta }[] = [];

  for (const delta of params.deltas) {
    const found = stockDocs.get(delta.productId);
    if (!found) {
      failed.push({ delta, error: `Product ${delta.productId} not found in inventory or products` });
      continue;
    }
    const currentStock = clampStock(found.data.stock);
    const nextStock = Math.max(0, currentStock - delta.delta);
    const stockStatus = deriveStockStatus(nextStock, found.data.lowStockThreshold ?? 1);
    pendingWrites.push({ ref: found.ref, stock: nextStock, stockStatus, delta });
  }

  // Writes start strictly after all reads have settled
  for (const w of pendingWrites) {
    ops.update(w.ref, { stock: w.stock, stockStatus: w.stockStatus });
    applied.push(w.delta);
  }

  ops.update(ticketRef, {
    partsUsed: params.fields.partsUsed,
    lastPartsActionId: params.actionId,
    updatedAt: params.fields.updatedAt,
  });

  return { applied, failed, adopted: false };
}

export async function runSaleEffectsTx(
  ops: FirestoreTxOps,
  params: {
    saleId: string;
    lines: CoreStockLine[];
    profile?: { customerId: string; paid: number; charged: number };
    rejectShortfall?: boolean;
  }
): Promise<{
  applied: CoreAppliedStock[];
  failed: { line: CoreStockLine; error: string }[];
  adopted: boolean;
}> {
  const { grouped, invalid } = groupPositiveLines(params.lines);

  const saleRef = ops.doc('transactions', params.saleId);
  const saleSnap = await ops.get(saleRef);
  if (!saleSnap.exists()) throw new Error(`Sale ${params.saleId} no longer exists`);

  const sale = saleSnap.data() ?? {};
  const moveStock = sale.stockApplied !== true;
  const moveProfile = !!params.profile?.customerId && sale.profileApplied !== true;

  if (!moveStock && !moveProfile) {
    return { applied: [], failed: [...invalid], adopted: true };
  }

  const stockDocs = moveStock
    ? await resolveStockDocsInTx(ops, [...grouped.keys()])
    : new Map<string, ResolvedStockDoc | null>();

  const customerRef = moveProfile && params.profile
    ? ops.doc('customers', params.profile.customerId)
    : null;
  const customerSnap = customerRef ? await ops.get(customerRef) : null;

  const applied: CoreAppliedStock[] = [];
  const missed: { line: CoreStockLine; error: string }[] = [];
  const stockUpdates: { ref: TxRef; stock: number; stockStatus: string }[] = [];

  if (moveStock) {
    for (const [productId, group] of grouped) {
      const line: CoreStockLine = { productId, name: group.name, quantity: group.quantity };
      const found = stockDocs.get(productId);
      if (!found) {
        if (params.rejectShortfall) {
          throw new Error(`INSUFFICIENT_STOCK: ${group.name || productId} not found in inventory or products`);
        }
        missed.push({ line, error: `Product ${productId} not found in inventory or products` });
        continue;
      }

      const previousStock = clampStock(found.data.stock);
      if (params.rejectShortfall && previousStock < group.quantity) {
        throw new Error(
          `INSUFFICIENT_STOCK: ${group.name || productId} (available ${previousStock}, requested ${group.quantity})`
        );
      }

      const stock = Math.max(0, previousStock - group.quantity);
      const stockStatus = deriveStockStatus(stock, found.data.lowStockThreshold ?? 1);
      stockUpdates.push({ ref: found.ref, stock, stockStatus });
      applied.push({ line, collection: found.collection, previousStock, stock, stockStatus });
    }
  }

  // All reads and validations complete; now issue writes
  for (const w of stockUpdates) {
    ops.update(w.ref, { stock: w.stock, stockStatus: w.stockStatus });
  }

  const stamp: Record<string, unknown> = {};
  if (moveStock) stamp.stockApplied = true;

  if (moveProfile && params.profile && customerRef) {
    if (customerSnap?.exists()) {
      const deltas = saleProfileDeltas(params.profile.paid, params.profile.charged);
      ops.update(customerRef, {
        ...profileTotalsAfter(customerSnap.data() ?? {}, deltas),
        lastVisitDate: new Date().toISOString(),
      });
    }
    stamp.profileApplied = true;
  }

  ops.update(saleRef, stamp);

  return { applied, failed: [...invalid, ...missed], adopted: false };
}

export async function runPosCheckoutTx(
  ops: FirestoreTxOps,
  params: {
    saleId: string;
    lines: CoreStockLine[];
    saleData: Record<string, unknown>;
    profile?: { customerId: string; paid: number; charged: number };
    debtId?: string;
    debtData?: Record<string, unknown>;
  }
): Promise<{
  applied: CoreAppliedStock[];
}> {
  const { grouped } = groupPositiveLines(params.lines);

  const stockDocs = await resolveStockDocsInTx(ops, [...grouped.keys()]);
  const customerRef = params.profile?.customerId
    ? ops.doc('customers', params.profile.customerId)
    : null;
  const customerSnap = customerRef ? await ops.get(customerRef) : null;

  const applied: CoreAppliedStock[] = [];
  const stockUpdates: { ref: TxRef; stock: number; stockStatus: string }[] = [];

  for (const [productId, group] of grouped) {
    const line: CoreStockLine = { productId, name: group.name, quantity: group.quantity };
    const found = stockDocs.get(productId);
    if (!found) {
      throw new Error(`INSUFFICIENT_STOCK: ${group.name || productId} was not found`);
    }
    const previousStock = clampStock(found.data.stock);
    if (previousStock < group.quantity) {
      throw new Error(
        `INSUFFICIENT_STOCK: ${group.name || productId} (${previousStock} left, ${group.quantity} requested)`
      );
    }
    const stock = previousStock - group.quantity;
    const stockStatus = deriveStockStatus(stock, found.data.lowStockThreshold ?? 1);
    stockUpdates.push({ ref: found.ref, stock, stockStatus });
    applied.push({ line, collection: found.collection, previousStock, stock, stockStatus });
  }

  for (const w of stockUpdates) {
    ops.update(w.ref, { stock: w.stock, stockStatus: w.stockStatus });
  }

  if (customerRef && params.profile && customerSnap?.exists()) {
    const deltas = saleProfileDeltas(params.profile.paid, params.profile.charged);
    ops.update(customerRef, {
      ...profileTotalsAfter(customerSnap.data() ?? {}, deltas),
      lastVisitDate: new Date().toISOString(),
    });
  }

  const finalSaleData: Record<string, unknown> = {
    ...params.saleData,
    stockApplied: true,
    financialRevision: 0,
    ...(params.profile?.customerId ? { profileApplied: true } : {}),
  };

  if (params.debtId && params.debtData) {
    const debtRef = ops.doc('customer_debts', params.debtId);
    ops.set(debtRef, {
      ...params.debtData,
      transactionId: params.saleId,
    });
    const prevSettlement =
      (params.saleData.accountSettlement as Record<string, unknown> | undefined) ?? {};
    finalSaleData.accountSettlement = {
      ...prevSettlement,
      debtEntryId: params.debtId,
    };
  }

  ops.set(ops.doc('transactions', params.saleId), finalSaleData);

  return { applied };
}

export async function runStoreCreditShiftTx(
  ops: FirestoreTxOps,
  params: {
    customerId: string;
    delta: number;
    note: string;
    actorName?: string;
    operationId?: string;
  }
): Promise<number> {
  const deltaCents = Math.round(params.delta * 100);
  if (!Number.isFinite(params.delta) || !Number.isSafeInteger(deltaCents)) {
    throw new Error('Invalid Avoir amount.');
  }

  const receiptRef = params.operationId
    ? ops.doc('operation_receipts', `avoir_${params.operationId}`)
    : null;
  const receiptSnap = receiptRef ? await ops.get(receiptRef) : null;

  const custRef = ops.doc('customers', params.customerId);
  const custSnap = await ops.get(custRef);

  if (receiptSnap?.exists()) {
    const r = receiptSnap.data() ?? {};
    if (r.customerId !== params.customerId || Number(r.deltaCents) !== deltaCents) {
      throw new Error('Avoir operationId already used for a different movement.');
    }
    return Number(r.newCredit) || 0;
  }

  if (!custSnap.exists()) throw new Error('Customer not found');
  const cust = custSnap.data() ?? {};
  const currentCents = Math.max(0, Math.round((Number(cust.storeCredit) || 0) * 100));
  const nextCents = currentCents + deltaCents;

  if (deltaCents < 0 && nextCents < 0) {
    throw new Error('Insufficient Avoir balance.');
  }

  const nextCredit = Math.max(0, nextCents / 100);
  const now = new Date().toISOString();

  ops.update(custRef, { storeCredit: nextCredit });

  if (receiptRef) {
    ops.set(receiptRef, {
      kind: 'avoir_shift',
      customerId: params.customerId,
      deltaCents,
      newCredit: nextCredit,
      createdAt: now,
    });
  }

  const logId = params.operationId
    ? `avoir_log_${params.operationId}`
    : `avoir_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const issued = deltaCents >= 0;

  ops.set(ops.doc('customer_activity_logs', logId), {
    customerId: params.customerId,
    customerName: String(cust.name || 'Customer'),
    actionType: issued ? 'store_credit_issued' : 'store_credit_used',
    actionTitle: issued ? 'Store Credit (Avoir) Issued' : 'Store Credit (Avoir) Redeemed',
    actionDescription: issued
      ? `Issued ${Math.abs(params.delta)} DA Store Credit. New balance: ${nextCredit} DA (${params.note}) by ${params.actorName || 'Staff'}.`
      : `Redeemed ${Math.abs(params.delta)} DA Store Credit. Remaining balance: ${nextCredit} DA (${params.note}) by ${params.actorName || 'Staff'}.`,
    actorName: params.actorName || 'Staff',
    metadata: { amount: Math.abs(params.delta), newCredit: nextCredit, note: params.note },
    date: now,
    createdAt: now,
  });

  return nextCredit;
}

export async function runSaleEditClaimAndStockTx(
  ops: FirestoreTxOps,
  params: {
    txId: string;
    expectedRevision: number;
    restockLines: CoreStockLine[];
    deductLines: CoreStockLine[];
    saleUpdates: Record<string, unknown>;
  }
): Promise<{
  appliedDeducts: CoreAppliedStock[];
  nextRevision: number;
}> {
  const netByProduct = new Map<string, { name: string; delta: number }>();
  for (const line of params.restockLines) {
    if (!line.productId || line.quantity <= 0) continue;
    const prev = netByProduct.get(line.productId);
    netByProduct.set(line.productId, {
      name: prev?.name || line.name,
      delta: (prev?.delta || 0) + Math.trunc(line.quantity),
    });
  }
  for (const line of params.deductLines) {
    if (!line.productId || line.quantity <= 0) continue;
    const prev = netByProduct.get(line.productId);
    netByProduct.set(line.productId, {
      name: prev?.name || line.name,
      delta: (prev?.delta || 0) - Math.trunc(line.quantity),
    });
  }

  const saleRef = ops.doc('transactions', params.txId);
  const saleSnap = await ops.get(saleRef);
  if (!saleSnap.exists()) throw new Error('Transaction no longer exists.');

  const saleData = saleSnap.data() ?? {};
  if (isSaleStatusClosed(saleData.status)) {
    throw new Error('This invoice was closed on another device and cannot be edited.');
  }

  const serverRev = Number(saleData.financialRevision) || 0;
  if (serverRev !== params.expectedRevision) {
    throw new Error('This invoice was changed on another device. Reload before editing.');
  }

  const stockDocs = await resolveStockDocsInTx(ops, [...netByProduct.keys()]);
  const pendingWrites: {
    ref: TxRef;
    stock: number;
    stockStatus: 'out_of_stock' | 'low_stock' | 'in_stock';
    productId: string;
    name: string;
    previousStock: number;
    delta: number;
    collection: StockCollectionName;
  }[] = [];

  for (const [productId, change] of netByProduct) {
    if (change.delta === 0) continue;
    const found = stockDocs.get(productId);
    if (!found) {
      if (change.delta < 0) {
        throw new Error(`INSUFFICIENT_STOCK: ${change.name || productId} no longer exists`);
      }
      continue;
    }
    const previousStock = clampStock(found.data.stock);
    const nextStock = previousStock + change.delta;
    if (change.delta < 0 && nextStock < 0) {
      throw new Error(
        `INSUFFICIENT_STOCK: ${change.name || productId} (${previousStock} left, ${Math.abs(change.delta)} requested)`
      );
    }
    const stock = Math.max(0, nextStock);
    const stockStatus = deriveStockStatus(stock, found.data.lowStockThreshold ?? 1);
    pendingWrites.push({
      ref: found.ref,
      stock,
      stockStatus,
      productId,
      name: change.name,
      previousStock,
      delta: change.delta,
      collection: found.collection,
    });
  }

  const nextRevision = serverRev + 1;
  const appliedDeducts: CoreAppliedStock[] = [];

  for (const w of pendingWrites) {
    ops.update(w.ref, { stock: w.stock, stockStatus: w.stockStatus });
    if (w.delta < 0) {
      appliedDeducts.push({
        line: { productId: w.productId, name: w.name, quantity: Math.abs(w.delta) },
        collection: w.collection,
        previousStock: w.previousStock,
        stock: w.stock,
        stockStatus: w.stockStatus,
      });
    }
  }

  ops.update(saleRef, {
    ...params.saleUpdates,
    financialRevision: nextRevision,
  });

  return { appliedDeducts, nextRevision };
}

export async function runSaleVoidClaimTx(
  ops: FirestoreTxOps,
  params: {
    txId: string;
    expectedRevision?: number;
    reason: string;
    now: string;
    voidedBy: { uid: string; name: string } | null;
    customerId?: string;
    storeCreditToRestore?: number;
  }
): Promise<{
  voided: boolean;
  restoredCredit: number;
  nextRevision: number;
}> {
  const creditCents = Math.max(0, Math.round((params.storeCreditToRestore || 0) * 100));

  const saleRef = ops.doc('transactions', params.txId);
  const saleSnap = await ops.get(saleRef);
  if (!saleSnap.exists()) throw new Error(`Invoice ${params.txId} no longer exists.`);

  const saleData = saleSnap.data() ?? {};
  if (isSaleStatusClosed(saleData.status)) {
    return {
      voided: false,
      restoredCredit: 0,
      nextRevision: Number(saleData.financialRevision) || 0,
    };
  }

  const serverRev = Number(saleData.financialRevision) || 0;
  if (params.expectedRevision !== undefined && serverRev !== params.expectedRevision) {
    throw new Error('This invoice was changed on another device. Reload before voiding.');
  }

  const voidReceiptRef = ops.doc('operation_receipts', `sale_void_${params.txId}`);
  const voidReceiptSnap = await ops.get(voidReceiptRef);

  const custRef =
    params.customerId && creditCents > 0 ? ops.doc('customers', params.customerId) : null;
  const custSnap = custRef ? await ops.get(custRef) : null;

  const nextRevision = serverRev + 1;

  ops.update(saleRef, {
    status: 'voided',
    voidedAt: params.now,
    refundedAt: params.now,
    voidedBy: params.voidedBy,
    voidReason: params.reason,
    financialRevision: nextRevision,
  });

  let restoredCredit = 0;
  if (custRef && custSnap?.exists() && creditCents > 0 && !voidReceiptSnap.exists()) {
    const cust = custSnap.data() ?? {};
    const currentCents = Math.max(0, Math.round((Number(cust.storeCredit) || 0) * 100));
    const nextCredit = (currentCents + creditCents) / 100;
    restoredCredit = creditCents / 100;

    ops.update(custRef, { storeCredit: nextCredit });
    ops.set(ops.doc('customer_activity_logs', `void_credit_${params.txId}`), {
      customerId: params.customerId,
      customerName: String(cust.name || 'Customer'),
      actionType: 'store_credit_issued',
      actionTitle: 'Store Credit Restored on Void',
      actionDescription: `Restored ${restoredCredit} DA Store Credit (Avoir) from voided invoice #${String(saleData.invoiceNumber || params.txId)}.`,
      actorName: params.voidedBy?.name || 'Staff',
      metadata: {
        transactionId: params.txId,
        amount: restoredCredit,
        newCredit: nextCredit,
      },
      date: params.now,
      createdAt: params.now,
    });
  }

  if (!voidReceiptSnap.exists()) {
    ops.set(voidReceiptRef, {
      kind: 'sale_void',
      transactionId: params.txId,
      restoredCredit,
      createdAt: params.now,
    });
  }

  return { voided: true, restoredCredit, nextRevision };
}
