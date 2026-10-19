import { describe, expect, it } from "vitest";
import {
  LABEL_STORAGE_KEY,
  MAX_LABEL_LENGTH,
  normalizeLabel,
  readLabels,
  removeAddressLabel,
  setAddressLabel,
  writeLabels,
} from "./addressLabels";

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const OTHER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

/** In-memory storage stand-in so tests never touch the real localStorage. */
function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(LABEL_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("normalizeLabel", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeLabel("  Exchange hot wallet  ")).toEqual({ ok: true, value: "Exchange hot wallet" });
  });

  it("rejects empty and whitespace-only labels", () => {
    expect(normalizeLabel("   ").ok).toBe(false);
  });

  it("accepts a label exactly at the length limit and rejects one past it", () => {
    expect(normalizeLabel("a".repeat(MAX_LABEL_LENGTH)).ok).toBe(true);
    expect(normalizeLabel("a".repeat(MAX_LABEL_LENGTH + 1))).toEqual({
      ok: false,
      error: `Label must be ${MAX_LABEL_LENGTH} characters or fewer.`,
    });
  });

  it("rejects control characters", () => {
    expect(normalizeLabel("bad\nlabel").ok).toBe(false);
  });
});

describe("readLabels / writeLabels", () => {
  it("returns an empty map when nothing is stored", () => {
    expect(readLabels(memoryStorage())).toEqual({});
  });

  it("returns an empty map for corrupt JSON instead of throwing", () => {
    expect(readLabels(memoryStorage("{not json"))).toEqual({});
  });

  it("drops entries that are not valid string labels", () => {
    const stored = JSON.stringify({ [ADDRESS]: "Treasury", [OTHER]: 42, bad: "" });
    expect(readLabels(memoryStorage(stored))).toEqual({ [ADDRESS]: "Treasury" });
  });

  it("returns an empty map for arrays and null payloads", () => {
    expect(readLabels(memoryStorage("[]"))).toEqual({});
    expect(readLabels(memoryStorage("null"))).toEqual({});
  });

  it("round-trips labels through storage", () => {
    const storage = memoryStorage();
    expect(writeLabels({ [ADDRESS]: "Treasury" }, storage)).toBe(true);
    expect(readLabels(storage)).toEqual({ [ADDRESS]: "Treasury" });
  });

  it("reports failure when storage is unavailable", () => {
    expect(readLabels(null)).toEqual({});
    expect(writeLabels({ [ADDRESS]: "Treasury" }, null)).toBe(false);
  });

  it("reports failure when the storage write throws (e.g. quota exceeded)", () => {
    const storage = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(writeLabels({ [ADDRESS]: "Treasury" }, storage)).toBe(false);
  });
});

describe("setAddressLabel / removeAddressLabel", () => {
  it("adds a label without mutating the previous map", () => {
    const before = { [OTHER]: "Old" };
    const result = setAddressLabel(before, ADDRESS, "  Treasury ");
    expect(result).toEqual({ ok: true, labels: { [OTHER]: "Old", [ADDRESS]: "Treasury" } });
    expect(before).toEqual({ [OTHER]: "Old" });
  });

  it("overwrites an existing label for the same address (edit)", () => {
    const result = setAddressLabel({ [ADDRESS]: "Treasury" }, ADDRESS, "Ops");
    expect(result).toEqual({ ok: true, labels: { [ADDRESS]: "Ops" } });
  });

  it("refuses invalid input and leaves the map unchanged", () => {
    const result = setAddressLabel({ [ADDRESS]: "Treasury" }, ADDRESS, "   ");
    expect(result.ok).toBe(false);
  });

  it("erases only the requested address", () => {
    const labels = { [ADDRESS]: "Treasury", [OTHER]: "Ops" };
    expect(removeAddressLabel(labels, ADDRESS)).toEqual({ [OTHER]: "Ops" });
    expect(labels).toHaveProperty(ADDRESS);
  });
});
