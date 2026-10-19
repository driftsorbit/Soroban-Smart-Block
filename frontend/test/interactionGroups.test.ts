/** Issue #1041 — account activity grouped by contract interaction, order preserved. */
import { describe, it, expect } from "vitest";
import { groupByInteraction } from "../src/utils/interactionGroups";

type Ev = { seq: number; contract_id: string; function: string };

const ev = (seq: number, contract_id: string, fn = "transfer"): Ev => ({ seq, contract_id, function: fn });

describe("groupByInteraction (#1041)", () => {
  it("returns no groups for no events", () => {
    expect(groupByInteraction([])).toEqual([]);
  });

  it("groups a single event into one group", () => {
    const groups = groupByInteraction([ev(1, "CA")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ contractId: "CA", startIndex: 0, functions: ["transfer"] });
    expect(groups[0].events.map((e) => e.seq)).toEqual([1]);
  });

  it("merges consecutive events on the same contract and collects distinct functions", () => {
    const groups = groupByInteraction([
      ev(1, "CA", "approve"),
      ev(2, "CA", "transfer"),
      ev(3, "CA", "transfer"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(groups[0].functions).toEqual(["approve", "transfer"]);
  });

  it("starts a new group when a contract is revisited, preserving event order", () => {
    const groups = groupByInteraction([ev(1, "CA"), ev(2, "CB"), ev(3, "CA"), ev(4, "CA")]);
    expect(groups.map((g) => g.contractId)).toEqual(["CA", "CB", "CA"]);
    expect(groups.map((g) => g.startIndex)).toEqual([0, 1, 2]);
    expect(groups.flatMap((g) => g.events.map((e) => e.seq))).toEqual([1, 2, 3, 4]);
  });

  it("does not reorder or mutate the input", () => {
    const input = [ev(3, "CB"), ev(1, "CA"), ev(2, "CA")];
    const snapshot = input.map((e) => ({ ...e }));
    groupByInteraction(input);
    expect(input).toEqual(snapshot);
  });

  it("keeps every event exactly once", () => {
    const input = Array.from({ length: 50 }, (_, i) => ev(i, i % 3 === 0 ? "CA" : "CB"));
    const groups = groupByInteraction(input);
    expect(groups.reduce((n, g) => n + g.events.length, 0)).toBe(input.length);
  });
});
