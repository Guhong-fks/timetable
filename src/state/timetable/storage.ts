import { getStoredValue, setStoredValue } from '@/lib/storage';
import { migrateToV4, EMPTY_SNAPSHOT, safeParse } from './migrate';
import type { TimetableSnapshot } from './types';
import { STORAGE_KEY, LEGACY_KEYS, CURRENT_VERSION } from './types';

/**
 * Load the latest snapshot from storage, migrating legacy payloads on
 * the fly. Order:
 *   1. Current (v4) key — fast path
 *   2. Each legacy key in `LEGACY_KEYS` (newest → oldest), adopting the
 *      first one that parses successfully.
 *   3. Falls back to `EMPTY_SNAPSHOT` when nothing usable is found.
 *
 * All reads run in PARALLEL (`Promise.all`) — the v4 key plus every legacy
 * key in one bridge round, instead of up to four serial `getStoredValue`
 * awaits on the startup path. `getStoredValue` never rejects (it catches
 * and returns null), so the parallel read cannot fail as a batch; adoption
 * order and the promote/clear side effects below stay identical.
 *
 * Side effect: when a legacy payload is adopted, it is re-persisted under
 * the v4 key and the legacy key is cleared. The migration therefore
 * self-heals — after one app launch with legacy data, subsequent
 * launches take the v4 fast path.
 */
export async function loadSnapshot(): Promise<TimetableSnapshot> {
  const [current, ...legacyRaws] = await Promise.all([
    getStoredValue(STORAGE_KEY),
    ...LEGACY_KEYS.map((key) => getStoredValue(key)),
  ]);

  if (current) {
    const parsed = safeParse(current);
    if (parsed) return migrateToV4(parsed);
  }

  for (let i = 0; i < LEGACY_KEYS.length; i++) {
    const raw = legacyRaws[i];
    if (!raw) continue;
    const parsed = safeParse(raw);
    if (!parsed) continue;

    const snapshot = migrateToV4(parsed);
    // Promote to v4 so future launches skip this loop.
    await persistSnapshot(snapshot);
    // Clear the legacy key — empty string is the established "delete"
    // convention used by the storage helper on the read-failure path.
    await setStoredValue(LEGACY_KEYS[i], '');
    return snapshot;
  }

  return EMPTY_SNAPSHOT;
}

/**
 * Persist the snapshot under the v4 key. Version is stamped here so the
 * caller never has to remember it. Failures are logged by `setStoredValue`
 * but not re-thrown — storage is best-effort and the in-memory state
 * remains the source of truth for the current session.
 */
export async function persistSnapshot(snapshot: TimetableSnapshot): Promise<void> {
  await setStoredValue(STORAGE_KEY, JSON.stringify({ version: CURRENT_VERSION, ...snapshot }));
}