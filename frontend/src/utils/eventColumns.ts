/**
 * Configurable event-table columns (#1039).
 *
 * The visible columns and their order are stored in localStorage. Stored
 * values are validated on every read, so a corrupt or outdated entry falls
 * back to the defaults instead of breaking the table.
 */

export const EVENT_COLUMN_IDS = ["seq", "ledger", "contract", "function", "description"] as const;
export type EventColumnId = (typeof EVENT_COLUMN_IDS)[number];

export const EVENT_COLUMN_LABELS: Record<EventColumnId, string> = {
  seq: "Seq",
  ledger: "Ledger",
  contract: "Contract",
  function: "Function",
  description: "Description",
};

export const DEFAULT_EVENT_COLUMNS: EventColumnId[] = [...EVENT_COLUMN_IDS];

export const EVENT_COLUMNS_STORAGE_KEY = "explorer.eventTable.columns";

const KNOWN = new Set<string>(EVENT_COLUMN_IDS);

/**
 * Validate an untrusted value (e.g. parsed JSON). Unknown and duplicate ids
 * are dropped. Anything that is not a non-empty list falls back to defaults.
 */
export function sanitizeEventColumns(value: unknown): EventColumnId[] {
  if (!Array.isArray(value)) return [...DEFAULT_EVENT_COLUMNS];
  const seen = new Set<EventColumnId>();
  for (const item of value) {
    if (typeof item === "string" && KNOWN.has(item)) seen.add(item as EventColumnId);
  }
  return seen.size > 0 ? Array.from(seen) : [...DEFAULT_EVENT_COLUMNS];
}

/** Toggle a column's visibility. The last visible column cannot be hidden. */
export function toggleEventColumn(columns: EventColumnId[], id: EventColumnId): EventColumnId[] {
  if (columns.includes(id)) {
    if (columns.length === 1) return columns;
    return columns.filter((c) => c !== id);
  }
  // Re-showing a hidden column inserts it after its nearest visible default
  // predecessor, so toggling never scrambles the user's chosen order.
  const defaultIndex = DEFAULT_EVENT_COLUMNS.indexOf(id);
  let insertAt = 0;
  for (let i = defaultIndex - 1; i >= 0; i--) {
    const pos = columns.indexOf(DEFAULT_EVENT_COLUMNS[i]);
    if (pos !== -1) {
      insertAt = pos + 1;
      break;
    }
  }
  return [...columns.slice(0, insertAt), id, ...columns.slice(insertAt)];
}

/** Move a visible column one step earlier (-1) or later (+1). */
export function moveEventColumn(columns: EventColumnId[], id: EventColumnId, delta: -1 | 1): EventColumnId[] {
  const from = columns.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= columns.length) return columns;
  const next = [...columns];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function loadEventColumns(storage: Pick<Storage, "getItem"> | null = safeStorage()): EventColumnId[] {
  try {
    const raw = storage?.getItem(EVENT_COLUMNS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_EVENT_COLUMNS];
    return sanitizeEventColumns(JSON.parse(raw));
  } catch {
    return [...DEFAULT_EVENT_COLUMNS];
  }
}

export function saveEventColumns(
  columns: EventColumnId[],
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
  try {
    storage?.setItem(EVENT_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Storage can be full or blocked; the in-memory choice still applies.
  }
}

export function clearEventColumns(storage: Pick<Storage, "removeItem"> | null = safeStorage()): void {
  try {
    storage?.removeItem(EVENT_COLUMNS_STORAGE_KEY);
  } catch {
    // Nothing to reset if storage is unavailable.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
