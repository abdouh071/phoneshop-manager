/**
 * Field-level base value capture and conflict detection for offline queued edits.
 * Ensures field-level patches do not silently overwrite concurrent changes made by
 * another terminal on the same fields, while allowing non-overlapping fields and
 * identical idempotent values to succeed cleanly.
 */
export function extractBaseValues(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
  skipKeys: ReadonlySet<string> = new Set(['updatedAt', 'syncedAt', 'lastVisitDate'])
): Record<string, unknown> | undefined {
  if (!existing) return undefined;
  const baseValues: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (skipKeys.has(key)) continue;
    baseValues[key] = Object.prototype.hasOwnProperty.call(existing, key)
      ? (existing[key] ?? null)
      : null;
  }
  return baseValues;
}

export function findConflictingField(
  serverRecord: Record<string, unknown>,
  patch: Record<string, unknown>,
  baseValues: Record<string, unknown> | undefined,
  skipKeys: ReadonlySet<string> = new Set(['updatedAt', 'syncedAt', 'lastVisitDate'])
): string | null {
  if (!baseValues) return null;
  for (const [key, nextVal] of Object.entries(patch)) {
    if (skipKeys.has(key) || nextVal === undefined) continue;
    const serverVal = serverRecord[key] ?? null;
    const targetVal = nextVal ?? null;
    if (JSON.stringify(serverVal) === JSON.stringify(targetVal)) continue;
    if (Object.prototype.hasOwnProperty.call(baseValues, key)) {
      const baseVal = baseValues[key] ?? null;
      if (JSON.stringify(serverVal) !== JSON.stringify(baseVal)) {
        return key;
      }
    }
  }
  return null;
}
