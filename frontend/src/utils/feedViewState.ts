/**
 * Remember the event-feed scroll offset per filter set so that returning to
 * the feed (for example via Back from an event detail page) lands where the
 * user left off. Filters themselves already round-trip through the URL query
 * string, so the query string is the key: each distinct filter set keeps its
 * own offset.
 */

const KEY_PREFIX = "feed-scroll:";

/** Subset of the Web Storage API used here, so tests can inject a fake. */
export interface ScrollStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage key for a feed filter set. A leading "?" is ignored. */
export function feedScrollKey(search: string): string {
  return `${KEY_PREFIX}${search.replace(/^\?/, "")}`;
}

/** Persist the scroll offset. Storage failures (private mode, quota) are ignored. */
export function saveFeedScroll(search: string, scrollTop: number, storage: ScrollStorage = sessionStorage): void {
  if (!Number.isFinite(scrollTop) || scrollTop < 0) return;
  try {
    storage.setItem(feedScrollKey(search), String(Math.round(scrollTop)));
  } catch {
    // Restoring scroll is a convenience; the feed works without it.
  }
}

/** Read the saved scroll offset, or 0 when nothing valid is stored. */
export function readFeedScroll(search: string, storage: ScrollStorage = sessionStorage): number {
  try {
    const raw = storage.getItem(feedScrollKey(search));
    if (raw === null) return 0;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}
