import { describe, it, expect } from "vitest";
import { feedScrollKey, readFeedScroll, saveFeedScroll, type ScrollStorage } from "./feedViewState";

function memoryStorage(): ScrollStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => void map.set(key, value),
  };
}

describe("feed scroll restore", () => {
  it("round-trips the offset for the same filter set", () => {
    const storage = memoryStorage();
    saveFeedScroll("?type=soroban&fn=swap", 840, storage);
    expect(readFeedScroll("?type=soroban&fn=swap", storage)).toBe(840);
  });

  it("keeps a separate offset for each filter set", () => {
    const storage = memoryStorage();
    saveFeedScroll("?fn=swap", 100, storage);
    saveFeedScroll("?fn=transfer", 900, storage);
    expect(readFeedScroll("?fn=swap", storage)).toBe(100);
    expect(readFeedScroll("?fn=transfer", storage)).toBe(900);
  });

  it("treats the empty query string as its own key", () => {
    const storage = memoryStorage();
    saveFeedScroll("", 42, storage);
    expect(readFeedScroll("", storage)).toBe(42);
    expect(feedScrollKey("")).toBe(feedScrollKey("?"));
  });

  it("returns 0 when nothing has been saved", () => {
    expect(readFeedScroll("?fn=none", memoryStorage())).toBe(0);
  });

  it("returns 0 for corrupt or negative stored values", () => {
    const storage = memoryStorage();
    storage.setItem(feedScrollKey("?a"), "not-a-number");
    storage.setItem(feedScrollKey("?b"), "-5");
    expect(readFeedScroll("?a", storage)).toBe(0);
    expect(readFeedScroll("?b", storage)).toBe(0);
  });

  it("ignores invalid offsets on save", () => {
    const storage = memoryStorage();
    saveFeedScroll("?a", Number.NaN, storage);
    saveFeedScroll("?a", -1, storage);
    expect(storage.map.size).toBe(0);
  });

  it("rounds fractional offsets", () => {
    const storage = memoryStorage();
    saveFeedScroll("?a", 10.6, storage);
    expect(readFeedScroll("?a", storage)).toBe(11);
  });

  it("does not throw when storage is unavailable", () => {
    const broken: ScrollStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => saveFeedScroll("?a", 5, broken)).not.toThrow();
    expect(readFeedScroll("?a", broken)).toBe(0);
  });
});
