import { describe, it, expect } from "vitest";
import { txEventOrder } from "./eventOrdering";

describe("txEventOrder", () => {
  it("numbers events within a transaction by ascending seq regardless of input order", () => {
    const order = txEventOrder([
      { seq: 12, tx_hash: "aaa" },
      { seq: 10, tx_hash: "aaa" },
      { seq: 11, tx_hash: "aaa" },
    ]);
    expect(order.get(10)).toEqual({ position: 1, total: 3, source: "seq" });
    expect(order.get(11)).toEqual({ position: 2, total: 3, source: "seq" });
    expect(order.get(12)).toEqual({ position: 3, total: 3, source: "seq" });
  });

  it("keeps transactions independent of each other", () => {
    const order = txEventOrder([
      { seq: 1, tx_hash: "aaa" },
      { seq: 2, tx_hash: "bbb" },
      { seq: 3, tx_hash: "aaa" },
    ]);
    expect(order.get(1)).toMatchObject({ position: 1, total: 2 });
    expect(order.get(3)).toMatchObject({ position: 2, total: 2 });
    expect(order.get(2)).toMatchObject({ position: 1, total: 1 });
  });

  it("gives no entry to events without a transaction hash", () => {
    const order = txEventOrder([
      { seq: 5, tx_hash: undefined },
      { seq: 6, tx_hash: "" },
    ]);
    expect(order.size).toBe(0);
  });

  it("returns an empty map for an empty list", () => {
    expect(txEventOrder([]).size).toBe(0);
  });
});
