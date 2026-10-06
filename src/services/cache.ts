/**
 * A small store of answers already fetched, held in memory for this tab.
 *
 * Copied from `smartdoc_viewer/src/services/cache.ts` rather than shared,
 * the same way `authService` is: the two front ends are deployed separately
 * and a shared package between them has to be versioned and released before
 * either can change. If you fix something here, look there too.
 *
 * Not a library and not localStorage. In memory, so it dies with the tab and
 * can never serve somebody yesterday's answer or another account's.
 *
 * **What it is mostly for here:** two screens asking for the same thing in
 * the same moment. The promise is stored, not the value, so they share one
 * request. The service token already had a cache of its *value*, which does
 * nothing for callers that start together — both miss, both fetch, and each
 * pays a CORS preflight as well.
 */

interface Entry<T> {
  value: Promise<T>;
  /** When it stops being usable. Infinity for "until sign-out". */
  until: number;
}

const store = new Map<string, Entry<unknown>>();

/** Long enough to cover reading a file; short enough that a signed link
 *  outlives it. The upload service signs for longer than this. */
export const SHORT = 4 * 60 * 1000;
export const FOREVER = Number.POSITIVE_INFINITY;

/**
 * The cached answer, or fetch it and keep it.
 *
 * The *promise* is stored, not the value, so two screens asking at the same
 * moment make one request between them rather than two — which is most of
 * the duplication worth removing. A failed request drops out again, so a
 * blip is not remembered as an answer.
 */
export function cached<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const held = store.get(key) as Entry<T> | undefined;
  if (held && held.until > Date.now()) return held.value;

  const value = fetcher().catch((error) => {
    store.delete(key);
    throw error;
  });

  store.set(key, { value, until: ttl === FOREVER ? FOREVER : Date.now() + ttl });
  return value;
}

/** Forget one key, or every key starting with this prefix. */
export function forget(prefix: string) {
  for (const key of [...store.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}:`)) store.delete(key);
  }
}

/** Forget everything. Used when somebody signs out — the next person at this
 *  browser must not be shown what this one fetched. */
export function forgetAll() {
  store.clear();
}
