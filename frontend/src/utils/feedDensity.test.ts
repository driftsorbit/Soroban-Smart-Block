import { describe, it, expect } from "vitest";
import { COMPACT_ROW_HEIGHT, feedRowHeight, parseFeedDensity } from "./feedDensity";
import { ROW_HEIGHT } from "../hooks/useVirtualList";

describe("feed density", () => {
  it("defaults to comfortable for missing or unknown values", () => {
    expect(parseFeedDensity(null)).toBe("comfortable");
    expect(parseFeedDensity(undefined)).toBe("comfortable");
    expect(parseFeedDensity("")).toBe("comfortable");
    expect(parseFeedDensity("dense")).toBe("comfortable");
  });

  it("accepts compact exactly", () => {
    expect(parseFeedDensity("compact")).toBe("compact");
    expect(parseFeedDensity("COMPACT")).toBe("comfortable");
  });

  it("uses the existing row height for comfortable and a smaller one for compact", () => {
    expect(feedRowHeight("comfortable")).toBe(ROW_HEIGHT);
    expect(feedRowHeight("compact")).toBe(COMPACT_ROW_HEIGHT);
    expect(COMPACT_ROW_HEIGHT).toBeLessThan(ROW_HEIGHT);
    expect(COMPACT_ROW_HEIGHT).toBeGreaterThan(0);
  });
});
