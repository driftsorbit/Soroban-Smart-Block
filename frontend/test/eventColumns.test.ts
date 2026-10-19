/** Issue #1039 — configurable event-table columns with local persistence. */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_EVENT_COLUMNS,
  EVENT_COLUMNS_STORAGE_KEY,
  clearEventColumns,
  loadEventColumns,
  moveEventColumn,
  sanitizeEventColumns,
  saveEventColumns,
  toggleEventColumn,
  type EventColumnId,
} from "../src/utils/eventColumns";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("sanitizeEventColumns (#1039)", () => {
  it("returns defaults for non-array input", () => {
    expect(sanitizeEventColumns(undefined)).toEqual(DEFAULT_EVENT_COLUMNS);
    expect(sanitizeEventColumns("seq")).toEqual(DEFAULT_EVENT_COLUMNS);
    expect(sanitizeEventColumns({ seq: true })).toEqual(DEFAULT_EVENT_COLUMNS);
  });

  it("returns defaults when nothing valid remains", () => {
    expect(sanitizeEventColumns([])).toEqual(DEFAULT_EVENT_COLUMNS);
    expect(sanitizeEventColumns(["bogus", 3, null])).toEqual(DEFAULT_EVENT_COLUMNS);
  });

  it("drops unknown and duplicate ids but keeps the stored order", () => {
    expect(sanitizeEventColumns(["function", "bogus", "seq", "function"])).toEqual(["function", "seq"]);
  });
});

describe("toggleEventColumn (#1039)", () => {
  it("hides a visible column", () => {
    expect(toggleEventColumn(["seq", "ledger", "contract"], "ledger")).toEqual(["seq", "contract"]);
  });

  it("refuses to hide the last visible column", () => {
    expect(toggleEventColumn(["seq"], "seq")).toEqual(["seq"]);
  });

  it("re-shows a hidden column after its nearest visible predecessor", () => {
    expect(toggleEventColumn(["seq", "contract", "description"], "ledger")).toEqual([
      "seq",
      "ledger",
      "contract",
      "description",
    ]);
  });

  it("re-shows a hidden first column at the start", () => {
    expect(toggleEventColumn(["ledger", "function"], "seq")).toEqual(["seq", "ledger", "function"]);
  });

  it("keeps a custom order when re-showing a column", () => {
    expect(toggleEventColumn(["description", "seq"], "ledger")).toEqual(["description", "seq", "ledger"]);
  });
});

describe("moveEventColumn (#1039)", () => {
  const cols: EventColumnId[] = ["seq", "ledger", "contract"];

  it("moves a column earlier and later", () => {
    expect(moveEventColumn(cols, "contract", -1)).toEqual(["seq", "contract", "ledger"]);
    expect(moveEventColumn(cols, "seq", 1)).toEqual(["ledger", "seq", "contract"]);
  });

  it("does nothing at the edges", () => {
    expect(moveEventColumn(cols, "seq", -1)).toBe(cols);
    expect(moveEventColumn(cols, "contract", 1)).toBe(cols);
  });

  it("does nothing for a hidden column", () => {
    expect(moveEventColumn(cols, "function", 1)).toBe(cols);
  });

  it("does not mutate the input", () => {
    const copy = [...cols];
    moveEventColumn(cols, "ledger", 1);
    expect(cols).toEqual(copy);
  });
});

describe("column persistence (#1039)", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadEventColumns(storage)).toEqual(DEFAULT_EVENT_COLUMNS);
  });

  it("round-trips a saved configuration", () => {
    saveEventColumns(["description", "seq"], storage);
    expect(loadEventColumns(storage)).toEqual(["description", "seq"]);
  });

  it("falls back to defaults for corrupt JSON", () => {
    storage.setItem(EVENT_COLUMNS_STORAGE_KEY, "{not json");
    expect(loadEventColumns(storage)).toEqual(DEFAULT_EVENT_COLUMNS);
  });

  it("sanitises stored values on read", () => {
    storage.setItem(EVENT_COLUMNS_STORAGE_KEY, JSON.stringify(["ledger", "removed-column"]));
    expect(loadEventColumns(storage)).toEqual(["ledger"]);
  });

  it("clear removes the stored preference", () => {
    saveEventColumns(["seq"], storage);
    clearEventColumns(storage);
    expect(loadEventColumns(storage)).toEqual(DEFAULT_EVENT_COLUMNS);
  });

  it("does not throw when storage is unavailable", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadEventColumns(throwing as unknown as Storage)).toEqual(DEFAULT_EVENT_COLUMNS);
    expect(() => saveEventColumns(["seq"], throwing as unknown as Storage)).not.toThrow();
    expect(() => clearEventColumns(throwing as unknown as Storage)).not.toThrow();
  });

  it("works with no storage at all", () => {
    expect(loadEventColumns(null)).toEqual(DEFAULT_EVENT_COLUMNS);
    expect(() => saveEventColumns(["seq"], null)).not.toThrow();
  });
});
