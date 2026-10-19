/** Issue #1038 — shareable ledger-range and filter state in the URL. */
import { describe, it, expect } from "vitest";
import {
  parseExplorerFilters,
  serializeExplorerFilters,
  filterByLedgerRange,
} from "../src/utils/explorerFilters";

const CONTRACT = "C" + "A".repeat(55);

describe("parseExplorerFilters (#1038)", () => {
  it("parses a complete valid view", () => {
    const params = new URLSearchParams({
      network: "testnet",
      from_ledger: "100",
      to_ledger: "200",
      contract: CONTRACT,
      fn: "transfer",
    });
    const { filters, errors } = parseExplorerFilters(params);
    expect(errors).toEqual([]);
    expect(filters).toEqual({
      network: "testnet",
      fromLedger: 100,
      toLedger: 200,
      contract: CONTRACT,
      fn: "transfer",
    });
  });

  it("returns empty filters for an empty query string", () => {
    const { filters, errors } = parseExplorerFilters(new URLSearchParams());
    expect(errors).toEqual([]);
    expect(filters).toEqual({ network: null, fromLedger: null, toLedger: null, contract: "", fn: "" });
  });

  it("reports an unknown network and drops it", () => {
    const { filters, errors } = parseExplorerFilters(new URLSearchParams({ network: "devnet" }));
    expect(filters.network).toBeNull();
    expect(errors).toEqual(['Unknown network "devnet"']);
  });

  it.each(["0", "-5", "1.5", "abc", "4294967296"])("rejects invalid ledger %s", (raw) => {
    const { filters, errors } = parseExplorerFilters(new URLSearchParams({ from_ledger: raw }));
    expect(filters.fromLedger).toBeNull();
    expect(errors).toHaveLength(1);
  });

  it("accepts the 32-bit ledger boundary", () => {
    const { filters, errors } = parseExplorerFilters(new URLSearchParams({ to_ledger: "4294967295" }));
    expect(errors).toEqual([]);
    expect(filters.toLedger).toBe(4294967295);
  });

  it("clears both bounds when from_ledger is greater than to_ledger", () => {
    const { filters, errors } = parseExplorerFilters(
      new URLSearchParams({ from_ledger: "500", to_ledger: "100" }),
    );
    expect(filters.fromLedger).toBeNull();
    expect(filters.toLedger).toBeNull();
    expect(errors).toEqual(["from_ledger must not be greater than to_ledger"]);
  });

  it("treats a single-ledger range as valid", () => {
    const { filters, errors } = parseExplorerFilters(
      new URLSearchParams({ from_ledger: "42", to_ledger: "42" }),
    );
    expect(errors).toEqual([]);
    expect(filters.fromLedger).toBe(42);
    expect(filters.toLedger).toBe(42);
  });

  it("rejects a malformed contract address", () => {
    const { filters, errors } = parseExplorerFilters(new URLSearchParams({ contract: "GNOTACONTRACT" }));
    expect(filters.contract).toBe("");
    expect(errors).toEqual(["contract must be a valid C... contract address"]);
  });

  it("rejects function names longer than 32 characters", () => {
    const tooLong = "a".repeat(33);
    const { filters, errors } = parseExplorerFilters(new URLSearchParams({ fn: tooLong }));
    expect(filters.fn).toBe("");
    expect(errors).toHaveLength(1);
  });

  it("accepts a 32-character function name", () => {
    const max = "a".repeat(32);
    const { filters, errors } = parseExplorerFilters(new URLSearchParams({ fn: max }));
    expect(errors).toEqual([]);
    expect(filters.fn).toBe(max);
  });
});

describe("serializeExplorerFilters (#1038)", () => {
  it("omits empty fields", () => {
    const params = serializeExplorerFilters({
      network: null,
      fromLedger: null,
      toLedger: 900,
      contract: "",
      fn: "swap",
    });
    expect(params.toString()).toBe("to_ledger=900&fn=swap");
  });

  it("round-trips through parse", () => {
    const original = {
      network: "mainnet" as const,
      fromLedger: 1,
      toLedger: 2,
      contract: CONTRACT,
      fn: "mint",
    };
    const { filters, errors } = parseExplorerFilters(serializeExplorerFilters(original));
    expect(errors).toEqual([]);
    expect(filters).toEqual(original);
  });
});

describe("filterByLedgerRange (#1038)", () => {
  const events = [{ ledger: 9 }, { ledger: 10 }, { ledger: 20 }, { ledger: 21 }];

  it("returns the input unchanged when no bound is set", () => {
    expect(filterByLedgerRange(events, null, null)).toBe(events);
  });

  it("keeps both bounds inclusive", () => {
    expect(filterByLedgerRange(events, 10, 20).map((e) => e.ledger)).toEqual([10, 20]);
  });

  it("applies a one-sided lower bound", () => {
    expect(filterByLedgerRange(events, 20, null).map((e) => e.ledger)).toEqual([20, 21]);
  });

  it("returns an empty list when nothing falls in range", () => {
    expect(filterByLedgerRange(events, 100, 200)).toEqual([]);
  });
});
