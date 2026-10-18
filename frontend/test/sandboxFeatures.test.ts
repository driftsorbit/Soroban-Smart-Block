import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  replayScenario,
  compareProtocols,
  listCollections,
  getCollection,
  saveCollection,
  deleteCollection,
  exportCollection,
  importCollection,
  validateSimulationAuth,
} from "../src/services/sandbox-api";

const VALID_CONTRACT = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3";
const ACCOUNT_A = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";

describe("Frontend Sandbox API Service (#1090-#1093)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("replayScenario (#1090)", () => {
    it("calls /api/sandbox/replay and returns deterministic replay result", async () => {
      const mockResult = {
        success: true,
        isDeterministic: true,
        isLedgerDependent: false,
        ledgerDependencies: [],
        warning: null,
        replayResult: {
          success: true,
          returnValue: "AAAAAA==",
          cost: { cpuInsns: 12000, memBytes: 4000 },
          events: [],
        },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response);

      const res = await replayScenario({
        contractId: VALID_CONTRACT,
        fn: "balance",
        args: [ACCOUNT_A],
        env: { sequence: 100000, timestamp: 1700000000, protocolVersion: 20 },
      });

      expect(res.success).toBe(true);
      expect(res.isDeterministic).toBe(true);
      expect(res.isLedgerDependent).toBe(false);
    });

    it("throws on replay failure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
        json: async () => ({ error: "Missing contractId" }),
      } as Response);

      await expect(replayScenario({ contractId: "", fn: "test", args: [] })).rejects.toThrow("Missing contractId");
    });
  });

  describe("compareProtocols (#1091)", () => {
    it("calls /api/sandbox/compare-protocols and returns comparison across protocol versions", async () => {
      const mockResult = {
        success: true,
        contractId: VALID_CONTRACT,
        fn: "transfer",
        supportedProtocols: [20, 21, 22],
        comparisons: [
          {
            protocol: 20,
            label: "Protocol 20",
            environment: { protocol: 20, network: "testnet", status: "supported" },
            success: true,
            cost: { cpuInsns: 10000, memBytes: 2048 },
            minResourceFee: 350,
            events: [],
          },
          {
            protocol: 22,
            label: "Protocol 22",
            environment: { protocol: 22, network: "testnet", status: "supported" },
            success: true,
            cost: { cpuInsns: 9000, memBytes: 1945 },
            minResourceFee: 320,
            events: [],
          },
        ],
        deltas: [
          {
            baselineProtocol: 20,
            comparedProtocol: 22,
            cpuDelta: -1000,
            cpuPercentChange: -10,
            memDelta: -103,
            memPercentChange: -5.03,
            returnValueMatch: true,
            errorMatch: true,
          },
        ],
        summary: "Compared simulation across protocols 20, 22.",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response);

      const res = await compareProtocols(VALID_CONTRACT, "transfer", [ACCOUNT_A, 50], [20, 22]);
      expect(res.success).toBe(true);
      expect(res.comparisons.length).toBe(2);
      expect(res.deltas[0].cpuDelta).toBe(-1000);
    });
  });

  describe("Scenario Collections (#1092)", () => {
    it("lists, gets, saves, deletes, exports, and imports scenario collections", async () => {
      // List
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ collections: [{ id: "col-1", name: "Suite 1", scenarioCount: 2 }], total: 1 }),
      } as Response);
      const list = await listCollections();
      expect(list.collections.length).toBe(1);

      // Save
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ collection: { id: "col-1", name: "Suite 1" }, strippedSecretsCount: 0 }),
      } as Response);
      const saved = await saveCollection({ name: "Suite 1" });
      expect(saved.collection.id).toBe("col-1");

      // Export
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: 1, collection: { id: "col-1" }, strippedSecretsCount: 0 }),
      } as Response);
      const exported = await exportCollection("col-1");
      expect(exported.version).toBe(1);

      // Import
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, collection: { id: "col-new" }, strippedSecretsCount: 1 }),
      } as Response);
      const imported = await importCollection({ name: "Imported Suite" });
      expect(imported.success).toBe(true);

      // Delete
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => ({ deleted: true, id: "col-1" }),
      } as Response);
      await expect(deleteCollection("col-1")).resolves.not.toThrow();
    });
  });

  describe("validateSimulationAuth (#1093)", () => {
    it("calls /api/sandbox/validate-auth and returns auth validation status", async () => {
      const mockResult = {
        valid: false,
        contractId: VALID_CONTRACT,
        function: "transfer",
        requiredEntries: [
          {
            signer: ACCOUNT_A,
            scope: `${VALID_CONTRACT}:transfer`,
            reason: "Authorization required",
            status: "missing" as const,
          },
        ],
        missing: [
          {
            signer: ACCOUNT_A,
            scope: `${VALID_CONTRACT}:transfer`,
            reason: "Authorization required",
          },
        ],
        malformed: [],
        providedEntries: [],
        explanation: "Missing 1 required authorization entry",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      } as Response);

      const res = await validateSimulationAuth(VALID_CONTRACT, "transfer", [ACCOUNT_A, 100]);
      expect(res.valid).toBe(false);
      expect(res.missing.length).toBe(1);
      expect(res.missing[0].signer).toBe(ACCOUNT_A);
    });
  });
});
