import { describe, it, expect } from "vitest";
import { decodedView, flattenFieldPaths, linkDecodedToRaw, rawBlocks } from "./xdrFieldPaths";

describe("flattenFieldPaths", () => {
  it("flattens nested objects and arrays into dotted and indexed paths", () => {
    const paths = flattenFieldPaths({
      function: "transfer",
      heuristic_params: [{ index: 1, value: "5 USDC" }],
    });
    expect(paths).toEqual([
      { path: "function", value: "transfer" },
      { path: "heuristic_params[0].index", value: "1" },
      { path: "heuristic_params[0].value", value: "5 USDC" },
    ]);
  });

  it("returns a root path for a bare primitive", () => {
    expect(flattenFieldPaths("hello")).toEqual([{ path: "$", value: "hello" }]);
  });

  it("keeps empty containers as visible leaves", () => {
    expect(flattenFieldPaths({ items: [] })).toEqual([{ path: "items", value: "[]" }]);
    expect(flattenFieldPaths({})).toEqual([{ path: "$", value: "{}" }]);
  });

  it("renders null and boolean leaves as text", () => {
    expect(flattenFieldPaths({ ok: true, gone: null })).toEqual([
      { path: "ok", value: "true" },
      { path: "gone", value: "null" },
    ]);
  });
});

describe("rawBlocks", () => {
  it("lists each topic in order followed by the data blob when present", () => {
    expect(rawBlocks({ raw_topics: ["T0", "T1"], raw_data: "D" })).toEqual([
      { key: "raw_topics[0]", value: "T0" },
      { key: "raw_topics[1]", value: "T1" },
      { key: "raw_data", value: "D" },
    ]);
  });

  it("omits the data block when there is no data", () => {
    expect(rawBlocks({ raw_topics: ["T0"] })).toEqual([{ key: "raw_topics[0]", value: "T0" }]);
  });
});

describe("linkDecodedToRaw", () => {
  it("links the function to the first topic and the description to the data blob", () => {
    expect(linkDecodedToRaw({ raw_topics: ["T0"], raw_data: "D" })).toEqual({
      function: "raw_topics[0]",
      description: "raw_data",
    });
  });

  it("links heuristic argument paths to the raw block that holds their raw value", () => {
    const links = linkDecodedToRaw({
      raw_topics: ["T0", "AAAAEQ=="],
      raw_data: undefined,
      heuristic_params: [{ index: 1, raw: "AAAAEQ==", type: "Amount", value: "5 USDC", confidence: "likely" }],
    });
    expect(links["heuristic_params[0].raw"]).toBe("raw_topics[1]");
    expect(links["heuristic_params[0].value"]).toBe("raw_topics[1]");
  });

  it("leaves paths with no traceable raw source unlinked", () => {
    const links = linkDecodedToRaw({
      raw_topics: ["T0"],
      heuristic_params: [{ index: 0, raw: "NOT-IN-XDR", type: "Unknown", value: "?", confidence: "possible" }],
    });
    expect(links).not.toHaveProperty("heuristic_params[0].raw");
    expect(links).not.toHaveProperty("description");
  });
});

describe("decodedView", () => {
  it("defaults missing heuristic params to an empty list", () => {
    expect(decodedView({ function: "mint", description: "Minted" })).toEqual({
      function: "mint",
      description: "Minted",
      heuristic_params: [],
    });
  });
});
