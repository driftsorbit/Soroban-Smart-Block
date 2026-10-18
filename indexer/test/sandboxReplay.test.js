import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateScenario, simulateScenarioDeterministically, replayScenario } from "../src/sandboxReplay.js";

const VALID_CONTRACT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3";
const ACCOUNT_A = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";

describe("sandboxReplay (#1090)", () => {
  describe("Scenario Validation", () => {
    it("validates valid contract-call scenario", () => {
      const scenario = validateScenario({
        contractId: VALID_CONTRACT,
        fn: "transfer",
        args: [ACCOUNT_A, 100],
        env: {
          protocolVersion: 20,
          sequence: 105000,
          timestamp: 1718000000,
        },
      });

      assert.equal(scenario.contractId, VALID_CONTRACT);
      assert.equal(scenario.fn, "transfer");
      assert.equal(scenario.env.protocolVersion, 20);
      assert.equal(scenario.env.sequence, 105000);
      assert.equal(scenario.env.timestamp, 1718000000);
    });

    it("rejects empty or invalid scenario input", () => {
      assert.throws(() => validateScenario(null), /non-empty object/);
      assert.throws(() => validateScenario({}), /non-empty object/);
      assert.throws(() => validateScenario({ contractId: "" }), /contractId is required/);
      assert.throws(() => validateScenario({ contractId: "invalid", fn: "test" }), /valid 56-character/);
      assert.throws(() => validateScenario({ contractId: VALID_CONTRACT, fn: "" }), /fn.*is required/);
      assert.throws(
        () => validateScenario({ contractId: VALID_CONTRACT, fn: "test", args: "not-json" }),
        /Invalid args/,
      );
    });
  });

  describe("Deterministic Simulation", () => {
    it("produces identical results for identical inputs and environment", () => {
      const scenario = validateScenario({
        contractId: VALID_CONTRACT,
        fn: "balance",
        args: [ACCOUNT_A],
        env: { protocolVersion: 20, sequence: 100000, timestamp: 1700000000 },
      });

      const run1 = simulateScenarioDeterministically(scenario);
      const run2 = simulateScenarioDeterministically(scenario);

      assert.equal(run1.returnValue, run2.returnValue);
      assert.equal(run1.cost.cpuInsns, run2.cost.cpuInsns);
      assert.equal(run1.cost.memBytes, run2.cost.memBytes);
      assert.equal(run1.events.join(","), run2.events.join(","));
    });
  });

  describe("Replay and Ledger-Dependency Flagging", () => {
    it("replays pure scenario and verifies deterministic, ledger-independent outcome", async () => {
      const scenario = {
        contractId: VALID_CONTRACT,
        fn: "pure_compute",
        args: [10, 20],
        env: {
          protocolVersion: 20,
          sequence: 100000,
          timestamp: 1700000000,
        },
      };

      const res = await replayScenario(scenario);
      assert.equal(res.success, true);
      assert.equal(res.isDeterministic, true);
      assert.equal(res.isLedgerDependent, false);
      assert.equal(res.ledgerDependencies.length, 0);
      assert.equal(res.warning, null);
      assert.ok(res.replayResult.returnValue);
    });

    it("compares against baseline result and checks matching determinism", async () => {
      const scenario = {
        contractId: VALID_CONTRACT,
        fn: "calculate",
        args: [123],
        env: { protocolVersion: 20, sequence: 100000, timestamp: 1700000000 },
      };

      // Generate baseline
      const initial = await replayScenario(scenario);

      // Replay with baselineResult provided
      const replayedWithBaseline = await replayScenario({
        ...scenario,
        baselineResult: initial.replayResult,
      });

      assert.equal(replayedWithBaseline.isDeterministic, true);
      assert.ok(replayedWithBaseline.comparison);
      assert.equal(replayedWithBaseline.comparison.matched, true);
      assert.equal(replayedWithBaseline.comparison.returnValueMatch, true);
      assert.equal(replayedWithBaseline.comparison.costDelta.cpuInsns, 0);
    });

    it("flags ledger-dependent results when function relies on timestamp/sequence constraints", async () => {
      const timeScenario = {
        contractId: VALID_CONTRACT,
        fn: "check_timelock_vesting",
        args: [ACCOUNT_A, "deadline_after_2026"],
        env: {
          protocolVersion: 20,
          sequence: 100000,
          timestamp: 1700000000,
        },
      };

      const res = await replayScenario(timeScenario);
      assert.equal(res.success, true);
      assert.equal(res.isLedgerDependent, true);
      assert.ok(res.ledgerDependencies.length > 0);
      assert.ok(res.warning.includes("Ledger-dependent results detected"));
    });
  });
});
