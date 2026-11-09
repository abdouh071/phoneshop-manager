import { describe, it, expect } from 'vitest';
import { mergeStatusHistory } from './statusHistoryMerge';
import type { RepairStatusHistoryEntry } from '../types';

const entry = (status: string, actor: string, at: string): RepairStatusHistoryEntry => ({
  status: status as RepairStatusHistoryEntry['status'],
  changedById: actor,
  changedByName: actor,
  at,
});

describe('mergeStatusHistory', () => {
  it('appends only entries the live document does not already hold', () => {
    const live = [entry('pending', 'A', '2026-11-09T08:00:00.000Z')];
    const incoming = [
      entry('pending', 'A', '2026-11-09T08:00:00.000Z'),
      entry('in_progress', 'B', '2026-11-09T09:00:00.000Z'),
    ];
    expect(mergeStatusHistory(live, incoming)).toEqual([
      entry('pending', 'A', '2026-11-09T08:00:00.000Z'),
      entry('in_progress', 'B', '2026-11-09T09:00:00.000Z'),
    ]);
  });

  it('keeps the live array untouched when everything is already known', () => {
    const live = [entry('ready', 'A', '2026-11-09T10:00:00.000Z')];
    const result = mergeStatusHistory(live, [entry('ready', 'A', '2026-11-09T10:00:00.000Z')]);
    expect(result).toBe(live);
  });

  it('a stale replay cannot erase entries written after it was queued', () => {
    const live = [
      entry('pending', 'A', '2026-11-09T08:00:00.000Z'),
      entry('in_progress', 'desktop', '2026-11-09T09:30:00.000Z'),
    ];
    const staleReplay = [
      entry('pending', 'A', '2026-11-09T08:00:00.000Z'),
      entry('in_progress', 'phone', '2026-11-09T09:00:00.000Z'),
    ];
    expect(mergeStatusHistory(live, staleReplay)).toEqual([
      entry('pending', 'A', '2026-11-09T08:00:00.000Z'),
      entry('in_progress', 'desktop', '2026-11-09T09:30:00.000Z'),
      entry('in_progress', 'phone', '2026-11-09T09:00:00.000Z'),
    ]);
  });

  it('an empty incoming array changes nothing', () => {
    const live = [entry('pending', 'A', '2026-11-09T08:00:00.000Z')];
    expect(mergeStatusHistory(live, [])).toBe(live);
  });
});
