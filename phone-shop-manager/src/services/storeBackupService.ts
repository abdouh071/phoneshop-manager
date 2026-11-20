import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  writeBatch,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Full-store disaster backup and restore.
 *
 * A backup has to survive two things the old export did not: a collection whose name does not
 * exist (it read `products`/`parts`; the inventory lives in `inventory`) and a Firestore value
 * that JSON has no representation for (`Timestamp`). Both used to fail silently — the download
 * succeeded, the toast reported a total, and the file was empty or unrestorable.
 */

export const BACKUP_FORMAT = 'phoneshop-store-backup' as const;
/** 3: collection list corrected, values encoded for round-trip, per-collection status recorded. */
export const BACKUP_VERSION = 3;

/** Firestore collections that hold durable store data. Queues and drafts are included: losing a
 *  suspended cart is still losing work. */
export const BACKUP_COLLECTIONS: readonly string[] = [
  'settings',
  'counters',
  'users',
  'customers',
  'customer_debts',
  'customer_activity_logs',
  'operation_receipts',
  'inventory',
  'repairs',
  'transactions',
  'carts',
  'suspended_carts',
  'parts_suspended_carts',
  'suppliers',
  'purchaseOrders',
  'restockLogs',
  'writeOffLogs',
  'activityLogs',
  'approvalRequests',
  'end_of_day',
];

/** Collections whose Firestore rules only accept new documents. Restoring over an existing
 *  append-only log is rejected server-side, so the UI warns before it is attempted. */
export const APPEND_ONLY_COLLECTIONS: readonly string[] = [
  'restockLogs',
  'writeOffLogs',
  'activityLogs',
  'customer_activity_logs',
  'operation_receipts',
];

/** Writes an admin should uncheck deliberately rather than restore blindly: these documents
 *  carry credentials hashes and the ticket-number sequence. */
export const RESTORE_OPT_IN_COLLECTIONS: readonly string[] = ['users', 'counters'];

/** Firestore caps a commit at 500 operations; leave headroom for documents with large payloads. */
const BATCH_SIZE = 400;
const PAGE_SIZE = 400;

export interface EncodedTimestamp {
  __type: 'timestamp';
  seconds: number;
  nanoseconds: number;
}

export type BackupValue =
  | string
  | number
  | boolean
  | null
  | EncodedTimestamp
  | BackupValue[]
  | { [key: string]: BackupValue };

export type BackupData = { [key: string]: BackupValue };

export interface BackupDocument {
  id: string;
  data: BackupData;
}

export interface BackupCollectionReport {
  name: string;
  status: 'ok' | 'failed';
  count: number;
  error?: string;
}

export interface StoreBackupArtifact {
  format: typeof BACKUP_FORMAT;
  version: number;
  metadata: {
    app: string;
    storeName: string;
    currency: string;
    exportedAt: string;
    version: number;
    generatedBy: 'client';
  };
  reports: BackupCollectionReport[];
  collections: Record<string, BackupDocument[]>;
}

const isEncodedTimestamp = (value: BackupValue): value is EncodedTimestamp =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  value.__type === 'timestamp' &&
  typeof value.seconds === 'number' &&
  typeof value.nanoseconds === 'number';

/** Firestore hands back `Timestamp` instances; `JSON.stringify` turns them into
 *  `{seconds, nanoseconds}` which restores as a plain object and corrupts every date field.
 *  Tagging them keeps the round-trip lossless. */
export const encodeValue = (value: unknown): BackupValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value instanceof Date) {
    return { __type: 'timestamp', seconds: Math.floor(value.getTime() / 1000), nanoseconds: (value.getTime() % 1000) * 1e6 };
  }
  const candidate = value as { seconds?: unknown; nanoseconds?: unknown; toDate?: unknown };
  if (
    typeof candidate.seconds === 'number' &&
    typeof candidate.nanoseconds === 'number' &&
    typeof candidate.toDate === 'function'
  ) {
    return { __type: 'timestamp', seconds: candidate.seconds, nanoseconds: candidate.nanoseconds };
  }
  const encoded: BackupData = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    encoded[key] = encodeValue(inner);
  }
  return encoded;
};

export const decodeValue = (value: BackupValue): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map(decodeValue);
  if (isEncodedTimestamp(value)) return new Timestamp(value.seconds, value.nanoseconds);
  const decoded: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    decoded[key] = decodeValue(inner);
  }
  return decoded;
};

/** ISO string for spreadsheet cells; reads encoded timestamps back as dates. */
export const valueToCsvCell = (value: BackupValue): string => {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isEncodedTimestamp(value)) {
    return new Timestamp(value.seconds, value.nanoseconds).toDate().toISOString();
  }
  return JSON.stringify(value);
};

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown Firestore error';

/** Ordered by document id so a page can be resumed without a composite index. */
const pageQueryFor = (
  collectionName: string,
  cursor: QueryDocumentSnapshot<DocumentData> | null
): Query<DocumentData> => {
  const base: Query<DocumentData> = query(
    collection(db, collectionName),
    orderBy(documentId()),
    limit(PAGE_SIZE)
  );
  return cursor ? query(base, startAfter(cursor)) : base;
};

/** Reads every document in a collection in `PAGE_SIZE` slices. A single `getDocs` on a large
 *  collection either times out or silently truncates the download. */
export const fetchCollectionDocuments = async (
  collectionName: string,
  onPage?: (documents: BackupDocument[]) => void
): Promise<BackupDocument[]> => {
  const collected: BackupDocument[] = [];
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  for (;;) {
    const snap: QuerySnapshot<DocumentData> = await getDocs(pageQueryFor(collectionName, cursor));
    const page = snap.docs.map((d) => ({
      id: d.id,
      data: encodeValue(d.data()) as BackupData,
    }));
    collected.push(...page);
    onPage?.(page);
    if (snap.size < PAGE_SIZE) return collected;
    cursor = snap.docs[snap.docs.length - 1];
  }
};

const listExistingIds = async (collectionName: string): Promise<Set<string>> => {
  const ids = new Set<string>();
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

  for (;;) {
    const snap: QuerySnapshot<DocumentData> = await getDocs(pageQueryFor(collectionName, cursor));
    for (const d of snap.docs) ids.add(d.id);
    if (snap.size < PAGE_SIZE) return ids;
    cursor = snap.docs[snap.docs.length - 1];
  }
};

export interface ExportBackupOptions {
  storeName: string;
  currency: string;
  onCollection?: (name: string, index: number, total: number) => void;
}

export interface ExportBackupResult {
  artifact: StoreBackupArtifact;
  json: string;
  failed: BackupCollectionReport[];
}

/** Never throws for a collection it could not read: the result says which datasets are missing so
 *  the caller cannot report a complete backup that is silently half-empty. */
export const exportStoreBackup = async (
  options: ExportBackupOptions
): Promise<ExportBackupResult> => {
  const { storeName, currency, onCollection } = options;
  const collections: Record<string, BackupDocument[]> = {};
  const reports: BackupCollectionReport[] = [];

  for (let index = 0; index < BACKUP_COLLECTIONS.length; index++) {
    const name = BACKUP_COLLECTIONS[index];
    onCollection?.(name, index, BACKUP_COLLECTIONS.length);
    try {
      const documents = await fetchCollectionDocuments(name);
      collections[name] = documents;
      reports.push({ name, status: 'ok', count: documents.length });
    } catch (err: unknown) {
      collections[name] = [];
      reports.push({ name, status: 'failed', count: 0, error: messageOf(err) });
    }
  }

  const artifact: StoreBackupArtifact = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    metadata: {
      app: 'Phone Shop Manager Pro',
      storeName,
      currency,
      exportedAt: new Date().toISOString(),
      version: BACKUP_VERSION,
      generatedBy: 'client',
    },
    reports,
    collections,
  };

  return {
    artifact,
    json: JSON.stringify(artifact, null, 2),
    failed: reports.filter((r) => r.status === 'failed'),
  };
};

export const parseStoreBackup = (raw: string): StoreBackupArtifact => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('This file is not a backup.');

  const artifact = parsed as Partial<StoreBackupArtifact>;
  if (artifact.format !== BACKUP_FORMAT) {
    throw new Error('This file was not produced by the Phone Shop Manager backup tool.');
  }
  if (typeof artifact.version !== 'number' || artifact.version > BACKUP_VERSION) {
    throw new Error(`Backup format v${String(artifact.version)} is newer than this app understands.`);
  }
  if (artifact.version < BACKUP_VERSION) {
    throw new Error(
      'This is an old backup format. Export again from this version before restoring it.'
    );
  }
  if (typeof artifact.collections !== 'object' || artifact.collections === null) {
    throw new Error('This backup contains no collections.');
  }
  const collections = artifact.collections as Record<string, unknown>;
  for (const [name, documents] of Object.entries(collections)) {
    if (!Array.isArray(documents)) throw new Error(`Collection "${name}" is malformed.`);
  }
  return artifact as StoreBackupArtifact;
};

export type RestoreMode = 'skip-existing' | 'overwrite';

export interface RestoreCollectionReport {
  name: string;
  documents: number;
  written: number;
  skipped: number;
  failed: number;
  error?: string;
}

export interface RestoreBackupOptions {
  artifact: StoreBackupArtifact;
  collections: string[];
  mode: RestoreMode;
  onCollection?: (name: string, index: number, total: number) => void;
}

/** `setDoc` with the archived id, so documents keep their identity and a re-run of a failed
 *  restore replaces what it already wrote instead of duplicating it. */
export const restoreStoreBackup = async (
  options: RestoreBackupOptions
): Promise<RestoreCollectionReport[]> => {
  const { artifact, collections, mode, onCollection } = options;
  const reports: RestoreCollectionReport[] = [];

  for (let index = 0; index < collections.length; index++) {
    const name = collections[index];
    onCollection?.(name, index, collections.length);
    const documents = artifact.collections[name] ?? [];
    const report: RestoreCollectionReport = {
      name,
      documents: documents.length,
      written: 0,
      skipped: 0,
      failed: 0,
    };
    reports.push(report);
    if (documents.length === 0) continue;

    let existing: Set<string>;
    try {
      existing = await listExistingIds(name);
    } catch (err: unknown) {
      report.failed = documents.length;
      report.error = messageOf(err);
      continue;
    }

    const pending: BackupDocument[] = [];
    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      const chunk = pending.splice(0, pending.length);
      try {
        const batch = writeBatch(db);
        for (const d of chunk) {
          batch.set(doc(db, name, d.id), decodeValue(d.data) as DocumentData);
        }
        await batch.commit();
        report.written += chunk.length;
      } catch (err: unknown) {
        report.failed += chunk.length;
        report.error = messageOf(err);
      }
    };

    for (const d of documents) {
      if (mode === 'skip-existing' && existing.has(d.id)) {
        report.skipped++;
        continue;
      }
      pending.push(d);
      if (pending.length >= BATCH_SIZE) await flush();
    }
    await flush();
  }

  return reports;
};

export const fileStamp = (when: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}_${pad(
    when.getHours()
  )}${pad(when.getMinutes())}`;
};

export const backupFilename = (storeName: string, when: Date): string => {
  const sanitized = (storeName || 'phone_shop').toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `${sanitized}_full_backup_${fileStamp(when)}.json`;
};
