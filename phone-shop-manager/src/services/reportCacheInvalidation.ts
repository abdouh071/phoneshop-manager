let reportsCacheRevision = 0;

/** Current cache epoch; incremented whenever shop financial or stock state mutates. */
export function getReportsCacheRevision(): number {
  return reportsCacheRevision;
}

/** Marks cached report datasets as stale so the next report load queries fresh data. */
export function invalidateReportsCache(): void {
  reportsCacheRevision += 1;
}
