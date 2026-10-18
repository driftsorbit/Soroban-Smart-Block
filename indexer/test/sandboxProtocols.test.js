import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateProtocols,
  compareProtocolSimulations,
  SUPPORTED_PROTOCOLS,
  SUPPORTED_PROTOCOL_NUMBERS,
} from "../src/sandboxProtocols.js";

const VALID_CONTRACT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3";
const ACCOUNT_A = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";

describe("sandboxProtocols (#1091)", () => {
  describe("Protocol Version Validation", () => {
    it("returns default supported protocols when none specified", () => {
      const protocols = validateProtocols();
      assert.deepEqual(protocols, [20, 21, 22]);
    });

    it("accepts valid supported protocol list", () => {
      const protocols = validateProtocols([22, 20]);
      assert.deepEqual(protocols, [20, 22]);
    });

    it("rejects non-array or empty protocol list", () => {
      assert.throws(() => validateProtocols([]), /cannot be empty/);
      assert.throws(() => validateProtocols("20"), /must be an array/);
    });

    it("rejects unsupported protocol versions with clear list of supported versions", () => {
      assert.throws(() => validateProtocols([19]), /Unsupported protocol version: 19/);
      assert.throws(() => validateProtocols([99]), /Unsupported protocol version: 99/);
      assert.throws(() => validateProtocols(["abc"]), /must be an integer/);
    });
  });

  describe("Simulation Comparison Across Protocols", () => {
    it("compares simulation output and resource usage with clear environment labels", async () => {
      const res = await compareProtocolSimulations({
        contractId: VALID_CONTRACT,
        fn: "transfer",
        args: [ACCOUNT_A, 100],
      });

      assert.equal(res.success, true);
      assert.equal(res.contractId, VALID_CONTRACT);
      assert.equal(res.fn, "transfer");
      assert.equal(res.comparisons.length, 3);

      // Verify each comparison has clear environment labels
      for (const comp of res.comparisons) {
        assert.ok(SUPPORTED_PROTOCOL_NUMBERS.includes(comp.protocol));
        assert.ok(comp.label);
        assert.equal(comp.environment.status, "supported");
        assert.equal(comp.environment.network, "testnet");
        assert.ok(comp.cost.cpuInsns > 0);
        assert.ok(comp.cost.memBytes > 0);
        assert.ok(comp.minResourceFee > 0);
        assert.ok(comp.returnValue);
      }

      // Check deltas
      assert.equal(res.deltas.length, 2);
      const delta22 = res.deltas.find((d) => d.comparedProtocol === 22);
      assert.ok(delta22);
      assert.equal(delta22.baselineProtocol, 20);
      assert.ok(delta22.cpuDelta < 0); // Protocol 22 should be more CPU efficient
      assert.ok(delta22.cpuPercentChange < 0);
      assert.ok(res.summary.includes("Compared simulation across protocols"));
    });

    it("compares specific protocol subset", async () => {
      const res = await compareProtocolSimulations({
        contractId: VALID_CONTRACT,
        fn: "balance",
        args: [ACCOUNT_A],
        protocols: [20, 22],
      });

      assert.equal(res.comparisons.length, 2);
      assert.equal(res.comparisons[0].protocol, 20);
      assert.equal(res.comparisons[1].protocol, 22);
      assert.equal(res.deltas.length, 1);
    });

    it("rejects missing or empty contractId or fn", async () => {
      await assert.rejects(() => compareProtocolSimulations({}), /contractId is required/);
      await assert.rejects(() => compareProtocolSimulations({ contractId: VALID_CONTRACT }), /fn.*is required/);
      await assert.rejects(
        () => compareProtocolSimulations({ contractId: "invalid", fn: "test" }),
        /valid 56-character/,
      );
    });
  });
});
