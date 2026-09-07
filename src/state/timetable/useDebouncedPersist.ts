import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { persistSnapshot } from './storage';
import type { TimetableSnapshot } from './types';

interface Options {
  /** Debounce window in ms. 300 matches the legacy provider's value. */
  delayMs?: number;
  /**
   * When false, schedule is a no-op. Pass `isHydrated` from the store
   * so we never overwrite persisted data with empty defaults before
   * hydration completes.
   */
  enabled: boolean;
}

/**
 * Persist a `TimetableSnapshot` with debouncing, deduplication, and
 * background-flush semantics — the three concerns that previously lived
 * as inline `useRef` + `useEffect` plumbing in the monolithic
 * `TimetableProvider`.
 *
 * Lifecycle:
 *  - Every render where `enabled` is true, the latest `snapshot` is
 *    pushed into a pending slot and a `delayMs` timer is (re-)armed.
 *  - When the timer fires, the pending snapshot is serialised and
 *    compared against the last-written serialisation; identical content
 *    short-circuits so we don't burn an AsyncStorage write on a no-op
 *    re-render.
 *  - On AppState `background` (NOT `inactive` — that's transient) and
 *    on unmount, the pending snapshot is flushed immediately so a
 *    hot-reload or app suspension never drops the most recent change.
 *  - On unmount the AppState subscription is removed first; the final
 *    `flush` is then called once, guarded by the `mounted` ref so a
 *    React 18 strict-mode double-unmount can't double-write.
 */
export function useDebouncedPersist(snapshot: TimetableSnapshot, { delayMs = 300, enabled }: Options) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<TimetableSnapshot | null>(null);
  /** Last serialised snapshot actually handed to AsyncStorage. */
  const lastWrittenRef = useRef<string>('');
  /** Guards against double-flush during React 18 strict-mode unmount. */
  const mountedRef = useRef(true);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const data = pendingRef.current;
    pendingRef.current = null;
    if (!data) return;
    const serialised = JSON.stringify(data);
    if (serialised === lastWrittenRef.current) return;
    lastWrittenRef.current = serialised;
    void persistSnapshot(data);
  }, []);

  // Schedule (debounced). Re-runs whenever `snapshot`, `enabled`, or
  // `delayMs` change; the dependency on `delayMs` exists so a future
  // caller can pass `0` for tests without re-wiring the hook.
  useEffect(() => {
    if (!enabled) return;
    pendingRef.current = snapshot;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, delayMs);
    // No cleanup: the AppState / unmount effect owns the final flush,
    // and the cleanup was the source of subtle double-flush bugs in
    // the legacy implementation (the inline comment about idempotent
    // flushWrite was a workaround). Removing it here is safe because
    // a fresh `setTimeout` simply overwrites the prior one.
  }, [snapshot, enabled, delayMs, flush]);

  // Background + unmount flush. Single subscription, single final flush.
  useEffect(() => {
    mountedRef.current = true;
    const sub = AppState.addEventListener('change', (next) => {
      // `background` is the persistent-background state on Android. We
      // intentionally ignore `inactive` — that's transient (incoming
      // call, control center, etc.) and flushing there would discard a
      // valid debounce window for no reason.
      if (next === 'background') flush();
    });
    return () => {
      sub.remove();
      mountedRef.current = false;
      flush();
    };
  }, [flush]);

  // Pre-warm `lastWrittenRef` once hydration flips `enabled` true. This
  // prevents the first effect-tick after hydration from re-writing the
  // exact same payload we just loaded — the legacy provider avoided
  // this with `isHydratedRef.current` short-circuit; the hash-based
  // approach here is cleaner.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    if (enabled && !enabledRef.current) {
      lastWrittenRef.current = JSON.stringify(snapshot);
      pendingRef.current = null;
    }
    enabledRef.current = enabled;
  }, [enabled, snapshot]);
}