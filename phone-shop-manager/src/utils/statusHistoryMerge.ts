import type { RepairStatusHistoryEntry } from '../types';

/** The shape both apps write; the phone stamps `timestamp` alongside `at`. */
type HistoryLike = {
  status?: unknown;
  changedById?: unknown;
  changedByName?: unknown;
  at?: unknown;
  timestamp?: unknown;
};

/**
 * Append-only merge of two status histories.
 *
 * A status write carries the caller's snapshot of the history, and writing that
 * array verbatim used to erase entries another window (or a replayed offline
 * action) recorded in between. Entries the live document already holds are
 * never rewritten — both writers keep everything they each recorded.
 */
export const statusHistoryKey = (entry: HistoryLike): string =>
  `${String(entry.status ?? '')}|${String(entry.changedById ?? entry.changedByName ?? '')}|${String(entry.timestamp ?? entry.at ?? '')}`;

export const mergeStatusHistory = (
  live: RepairStatusHistoryEntry[],
  incoming: RepairStatusHistoryEntry[]
): RepairStatusHistoryEntry[] => {
  if (!incoming.length) return live;
  const known = new Set(live.map((entry) => statusHistoryKey(entry)));
  const added = incoming.filter((entry) => !known.has(statusHistoryKey(entry)));
  return added.length > 0 ? [...live, ...added] : live;
};
