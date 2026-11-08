/**
 * Atomic stock writes for the technician app.
 * =============================================
 * The previous code did `getDoc` → compute → `updateDoc` with a value read from the
 * phone's own copy of the product. Two tills selling the last screen, or a till
 * coming back online with a stale cache, produced last-write-wins stock. The
 * desktop app fixed this with a Firestore transaction (`commitStockDelta`); this is
 * the same primitive so both apps agree.
 *
 * Reads happen INSIDE the transaction, so the delta is always applied to the
 * server's current value rather than to anything the device remembered.
 */
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { clampStock, deriveStockStatus, profileTotalsAfter, saleProfileDeltas } from './offlineQueuePolicy';
import type { StockStatus } from '../types';

/** A till must not hang on a locked counter; the queue retries the delta later. */
const STOCK_TX_TIMEOUT_MS = 6_000;

const COLLECTIONS = ['inventory', 'products'] as const;
export type StockCollection = (typeof COLLECTIONS)[number];

export interface StockResult {
  collection: StockCollection;
  previousStock: number;
  stock: number;
  stockStatus: StockStatus;
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });

const readCurrentStock = async (id: string): Promise<{ collection: StockCollection; data: Record<string, unknown> } | null> => {
  for (const collectionName of COLLECTIONS) {
    const snap = await getDoc(doc(db, collectionName, id));
    if (snap.exists()) return { collection: collectionName, data: snap.data() as Record<string, unknown> };
  }
  return null;
};

/**
 * Independent product counters do not need to wait on each other. Each line still owns its
 * own transaction, so a contention abort on one SKU retries alone instead of taking the
 * whole sale with it.
 */
const STOCK_CONCURRENCY = 3;

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

/**
 * Applies `delta` (+ for returns, - for sales) to the server's current value.
 * Throws when the product exists in neither collection, so the caller can record
 * the failure instead of pretending stock moved.
 */
export const commitStockDelta = async (id: string, delta: number): Promise<StockResult> => {
  if (!id) throw new Error('commitStockDelta: missing product id');
  const amount = Math.trunc(Number(delta) || 0);

  return withTimeout(
    runTransaction(db, async (tx) => {
      // Try the collection the desktop app actually uses first.
      const invRef = doc(db, 'inventory', id);
      const invSnap = await tx.get(invRef);
      let ref = invRef;
      let data: Record<string, unknown> = invSnap.exists() ? (invSnap.data() as Record<string, unknown>) : {};
      let collection: StockCollection = 'inventory';

      if (!invSnap.exists()) {
        ref = doc(db, 'products', id);
        const prodSnap = await tx.get(ref);
        if (!prodSnap.exists()) throw new Error(`Product ${id} not found in inventory or products`);
        data = prodSnap.data() as Record<string, unknown>;
        collection = 'products';
      }

      const currentStock = clampStock(data.stock);
      const threshold = data.lowStockThreshold ?? 1;
      // Never below zero: an oversold line reads as 0, not as -3.
      const nextStock = Math.max(0, currentStock + amount);
      const stockStatus = deriveStockStatus(nextStock, threshold) as StockStatus;
      tx.update(ref, { stock: nextStock, stockStatus });
      return { collection, previousStock: currentStock, stock: nextStock, stockStatus };
    }),
    STOCK_TX_TIMEOUT_MS,
    'stockTransaction'
  );
};

export interface StockLine {
  productId: string;
  name: string;
  quantity: number;
}

/**
 * What the shelf holds right now, per product, without touching it.
 *
 * `commitStockDelta` is the only writer — it reads inside its own transaction and
 * cannot be fooled by a stale phone. This exists for the cases that have to be
 * decided before anything is recorded: an edit that wants units the shop does not
 * have, where the atomic write would clamp at zero and leave the ledger claiming a
 * sale the shelf cannot cover, and the editor itself, which should not offer a
 * quantity the counter cannot give.
 */
export const readStockLevels = async (ids: string[]): Promise<Map<string, number | null>> => {
  const unique = [...new Set(ids.filter(Boolean))];
  const levels = new Map<string, number | null>();

  await mapWithConcurrency(unique, STOCK_CONCURRENCY, async (id) => {
    const found = await readCurrentStock(id).catch(() => null);
    levels.set(id, found ? clampStock(found.data.stock) : null);
  });

  return levels;
};

export interface AppliedStockLine {
  line: StockLine;
  result: StockResult;
}

/**
 * A sale takes stock out; an old parts list goes back in; a new one comes out.
 * Per-line failures are reported rather than thrown, because one unknown SKU must
 * not abort the rest of a settled sale.
 *
 * Lines for the same product are folded into one delta before they reach Firestore:
 * the shelf count only has to be read and committed once per SKU, and the caller
 * gets a single final stock value instead of an alert per duplicate line.
 */
export const applyStockLines = async (
  lines: StockLine[],
  direction: -1 | 1
): Promise<{ ok: AppliedStockLine[]; failed: { line: StockLine; error: string }[] }> => {
  const ok: AppliedStockLine[] = [];
  const failed: { line: StockLine; error: string }[] = [];
  const grouped = new Map<string, { name: string; quantity: number }>();

  for (const line of lines) {
    const quantity = Math.trunc(Number(line.quantity) || 0);
    if (!line.productId) {
      failed.push({ line, error: 'missing product id' });
      continue;
    }
    // A zero-quantity line moves nothing; reporting it as a failure would be a lie
    // and as a success would invite a bogus low-stock alert.
    if (quantity <= 0) continue;
    const existing = grouped.get(line.productId);
    grouped.set(line.productId, {
      name: existing?.name || line.name,
      quantity: (existing?.quantity || 0) + quantity,
    });
  }

  await mapWithConcurrency([...grouped], STOCK_CONCURRENCY, async ([productId, group]) => {
    const line: StockLine = { productId, name: group.name, quantity: group.quantity };
    try {
      const result = await commitStockDelta(productId, direction * group.quantity);
      ok.push({ line, result });
    } catch (err) {
      failed.push({ line, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return { ok, failed };
};

/** Signed change in units of a part between two allocations of the same ticket. */
export interface PartsDelta {
  productId: string;
  name: string;
  /** Positive when the new list uses more of the part than the old one did. */
  delta: number;
}

/**
 * Diff between two parts lists, used when a technician edits an existing
 * allocation: a part removed from the ticket goes back on the shelf, a part added
 * comes off it, and an unchanged line moves nothing.
 */
export const diffParts = (
  previous: { productId?: string | null; name?: string; quantity?: number }[],
  next: { productId?: string | null; name?: string; quantity?: number }[]
): PartsDelta[] => {
  const key = (p: { productId?: string | null }) => String(p.productId || '').trim();
  // Parts typed by hand have no SKU on the shelf to move, so they are skipped.
  const usable = (p: { productId?: string | null }) => {
    const k = key(p);
    return !!k && k !== 'custom-mobile-part';
  };

  const tally = (list: { productId?: string | null; name?: string; quantity?: number }[]) => {
    const counts = new Map<string, { qty: number; name: string }>();
    for (const p of list || []) {
      if (!usable(p)) continue;
      const k = key(p);
      const prev = counts.get(k);
      counts.set(k, {
        qty: (prev?.qty || 0) + Math.max(1, Math.trunc(Number(p.quantity) || 1)),
        name: prev?.name || p.name || k,
      });
    }
    return counts;
  };

  const before = tally(previous);
  const after = tally(next);
  const deltas: PartsDelta[] = [];

  for (const [id, cur] of after) {
    const was = before.get(id)?.qty || 0;
    if (cur.qty !== was) deltas.push({ productId: id, name: cur.name, delta: cur.qty - was });
  }
  for (const [id, was] of before) {
    if (!after.has(id)) deltas.push({ productId: id, name: was.name, delta: -was.qty });
  }

  return deltas;
};

/**
 * Moves stock for a parts edit. Returns the lines that could not be applied so a
 * screen can tell the technician the allocation saved but the shelf count did not.
 */
export const applyPartsDelta = async (
  previous: { productId?: string | null; name?: string; quantity?: number }[],
  next: { productId?: string | null; name?: string; quantity?: number }[]
): Promise<{ applied: PartsDelta[]; failed: { delta: PartsDelta; error: string }[] }> => {
  const deltas = diffParts(previous, next);
  const applied: PartsDelta[] = [];
  const failed: { delta: PartsDelta; error: string }[] = [];

  // diffParts keys by product, so every delta here touches a different counter
  // and the writes cannot contend with each other.
  await mapWithConcurrency(deltas, STOCK_CONCURRENCY, async (delta) => {
    try {
      // A part added to the ticket leaves the shelf; a removed part returns to it.
      await commitStockDelta(delta.productId, -delta.delta);
      applied.push(delta);
    } catch (err) {
      failed.push({ delta, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return { applied, failed };
};

/** Read-only helper for screens that want the live number before writing. */
export const readStock = async (id: string): Promise<number | null> => {
  const found = await readCurrentStock(id);
  return found ? clampStock(found.data.stock) : null;
};

/** The fields a parts commit writes on the ticket, alongside the stock moves. */
export interface TicketPartsFields {
  partsUsed: { productId: string; name: string; cost: number; quantity: number }[];
  updatedAt: string;
}

export interface PartsCommitOutcome {
  applied: PartsDelta[];
  failed: { delta: PartsDelta; error: string }[];
  /** The ticket already carried this action's stamp, so nothing moved again. */
  adopted: boolean;
}

/**
 * One transaction moves the shelf AND stamps the ticket with the action id that
 * moved it. A crash between the stock write and the stamp used to leave the retry
 * free to deduct the same parts twice (delta-first order) or to skip the movement
 * entirely (stamp-first order); with both writes in one transaction, either the
 * whole allocation lands or none of it does, and a retry that finds its own stamp
 * adopts the document and moves nothing.
 */
export const commitPartsAllocation = async (
  ticketId: string,
  actionId: string,
  previous: { productId?: string | null; name?: string; quantity?: number }[],
  fields: TicketPartsFields
): Promise<PartsCommitOutcome> => {
  const deltas = diffParts(previous, fields.partsUsed);
  const applied: PartsDelta[] = [];
  const failed: { delta: PartsDelta; error: string }[] = [];
  let adopted = false;

  await withTimeout(
    runTransaction(db, async (tx) => {
      const ticketRef = doc(db, 'repairs', ticketId);
      const ticketSnap = await tx.get(ticketRef);
      if (!ticketSnap.exists()) throw new Error(`Ticket ${ticketId} no longer exists`);
      const current = ticketSnap.data() as Record<string, unknown>;

      if (current.lastPartsActionId === actionId) {
        adopted = true;
        return;
      }

      // diffParts keys by product, so every delta touches a different counter and
      // the writes inside this transaction cannot contend with each other.
      for (const delta of deltas) {
        let ref = doc(db, 'inventory', delta.productId);
        let snap = await tx.get(ref);
        if (!snap.exists()) {
          ref = doc(db, 'products', delta.productId);
          snap = await tx.get(ref);
          if (!snap.exists()) {
            failed.push({ delta, error: `Product ${delta.productId} not found in inventory or products` });
            continue;
          }
        }
        const data = snap.data() as Record<string, unknown>;
        const currentStock = clampStock(data.stock);
        const threshold = data.lowStockThreshold ?? 1;
        // A part added to the ticket leaves the shelf; a removed one returns to it.
        const nextStock = Math.max(0, currentStock - delta.delta);
        const stockStatus = deriveStockStatus(nextStock, threshold) as StockStatus;
        tx.update(ref, { stock: nextStock, stockStatus });
        applied.push(delta);
      }

      tx.update(ticketRef, {
        partsUsed: fields.partsUsed,
        lastPartsActionId: actionId,
        updatedAt: fields.updatedAt,
      });
    }),
    STOCK_TX_TIMEOUT_MS,
    'partsAllocation'
  );

  return { applied, failed, adopted };
};

/** The customer's own numbers this sale moves, when it was written on a profile. */
export interface SaleProfileEffect {
  customerId: string;
  paid: number;
  charged: number;
}

export interface SaleEffectsOutcome {
  applied: AppliedStockLine[];
  failed: { line: StockLine; error: string }[];
  /** The invoice already carried both stamps, so nothing moved a second time. */
  adopted: boolean;
}

/**
 * One transaction takes the sold units off the shelf, adds the sale to the customer's
 * own record, and stamps the invoice as having done both — the same shape as
 * `commitPartsAllocation`, with the invoice as the anchor.
 *
 * The stamps are what make an upload safe to retry. A sale rung up without signal can
 * reach the server while the phone believes it failed, so the sync pass finds the
 * document already there. "Already there" cannot tell a replay whose work is finished
 * from an invoice the server saved and nobody ever moved the shelf for, and gating the
 * side effects on `created` skipped the shelf and the ledger for exactly the sales that
 * needed them. Reading the stamps inside the transaction that writes them answers both:
 * a crash after the commit adopts and moves nothing, a half-committed sale is finished
 * once, and two devices racing to upload the same sale cannot both deduct it.
 */
export const commitSaleEffects = async (
  saleId: string,
  lines: StockLine[],
  profile?: SaleProfileEffect
): Promise<SaleEffectsOutcome> => {
  // A line with no SKU never reached the shelf, so it is reported before the transaction
  // rather than inside it — a retry of the transaction must not report it twice.
  const invalid: { line: StockLine; error: string }[] = [];
  const grouped = new Map<string, { name: string; quantity: number }>();
  for (const line of lines) {
    const quantity = Math.trunc(Number(line.quantity) || 0);
    if (!line.productId) {
      invalid.push({ line, error: 'missing product id' });
      continue;
    }
    if (quantity <= 0) continue;
    const existing = grouped.get(line.productId);
    grouped.set(line.productId, {
      name: existing?.name || line.name,
      quantity: (existing?.quantity || 0) + quantity,
    });
  }

  let applied: AppliedStockLine[] = [];
  let missed: { line: StockLine; error: string }[] = [];
  let adopted = false;

  await withTimeout(
    runTransaction(db, async (tx) => {
      // Firestore re-runs this function when a document it read moves underneath it, so
      // every attempt starts from an empty report rather than appending to the last one.
      applied = [];
      missed = [];
      adopted = false;

      const saleRef = doc(db, 'transactions', saleId);
      const saleSnap = await tx.get(saleRef);
      if (!saleSnap.exists()) throw new Error(`Sale ${saleId} no longer exists`);
      const sale = saleSnap.data() as Record<string, unknown>;

      const moveStock = sale.stockApplied !== true;
      const moveProfile = !!profile?.customerId && sale.profileApplied !== true;
      if (!moveStock && !moveProfile) {
        adopted = true;
        return;
      }

      if (moveStock) {
        for (const [productId, group] of grouped) {
          const line: StockLine = { productId, name: group.name, quantity: group.quantity };
          let ref = doc(db, 'inventory', productId);
          let snap = await tx.get(ref);
          let collection: StockCollection = 'inventory';
          if (!snap.exists()) {
            ref = doc(db, 'products', productId);
            snap = await tx.get(ref);
            collection = 'products';
            if (!snap.exists()) {
              missed.push({ line, error: `Product ${productId} not found in inventory or products` });
              continue;
            }
          }
          const data = snap.data() as Record<string, unknown>;
          const previousStock = clampStock(data.stock);
          const threshold = data.lowStockThreshold ?? 1;
          const stock = Math.max(0, previousStock - group.quantity);
          const stockStatus = deriveStockStatus(stock, threshold) as StockStatus;
          tx.update(ref, { stock, stockStatus });
          applied.push({ line, result: { collection, previousStock, stock, stockStatus } });
        }
      }

      const stamp: Record<string, unknown> = {};
      if (moveStock) stamp.stockApplied = true;

      if (moveProfile && profile) {
        const customerRef = doc(db, 'customers', profile.customerId);
        const customerSnap = await tx.get(customerRef);
        // A profile that has gone missing must not hold the shelf movement hostage: the
        // till's own writer warns and moves on, and the stamp records the same answer so
        // the next pass does not spend the sale on a customer who is no longer there.
        if (customerSnap.exists()) {
          const deltas = saleProfileDeltas(profile.paid, profile.charged);
          tx.update(customerRef, {
            ...profileTotalsAfter(customerSnap.data() as Record<string, unknown>, deltas),
            lastVisitDate: new Date().toISOString(),
          });
        }
        stamp.profileApplied = true;
      }

      tx.update(saleRef, stamp);
    }),
    STOCK_TX_TIMEOUT_MS,
    'saleEffects'
  );

  return { applied, failed: [...invalid, ...missed], adopted };
};
