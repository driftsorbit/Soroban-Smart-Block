import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectLookalikeRisk, normalizeHomoglyphs, levenshteinDistance } from "../src/lookalikeDetector.js";

describe("Lookalike Contract Name Detector (#1121)", () => {
  describe("normalizeHomoglyphs", () => {
    it("converts Cyrillic lookalikes to Latin letters", () => {
      // 'а' (U+0430) and 'с' (U+0441)
      const cyrillicUsdc = "USD\u0441";
      const normalized = normalizeHomoglyphs(cyrillicUsdc);
      assert.equal(normalized, "USDc");
    });

    it("converts leetspeak numbers to letter lookalikes", () => {
      assert.equal(normalizeHomoglyphs("US0C"), "USoC");
      assert.equal(normalizeHomoglyphs("St3ll4r"), "Stellar");
    });

    it("handles non-string and empty inputs safely", () => {
      assert.equal(normalizeHomoglyphs(""), "");
      assert.equal(normalizeHomoglyphs(null), "");
      assert.equal(normalizeHomoglyphs(undefined), "");
      assert.equal(normalizeHomoglyphs(12345), "");
    });
  });

  describe("levenshteinDistance", () => {
    it("computes correct edit distance", () => {
      assert.equal(levenshteinDistance("USDC", "USDC"), 0);
      assert.equal(levenshteinDistance("USDC", "USDT"), 1);
      assert.equal(levenshteinDistance("USDC", "USDD"), 1);
      assert.equal(levenshteinDistance("Stellar", "Stelllar"), 1);
      assert.equal(levenshteinDistance("", "abc"), 3);
      assert.equal(levenshteinDistance("abc", ""), 3);
    });
  });

  describe("detectLookalikeRisk", () => {
    const CONTRACT_ID = "CA3D5KRYMCMZ2ANU77PFJIYWVCQO4UN2PD5CQ";

    it("normal path: benign contract names have no lookalike warning", () => {
      const benign = ["MyCustomVault", "ChessGame", "CommunityDAO", "LiquidityPoolManager", "TicketIssuer"];
      for (const name of benign) {
        const result = detectLookalikeRisk({ id: CONTRACT_ID, name });
        assert.equal(result.is_lookalike, false, `Expected ${name} to not be flagged`);
      }
    });

    it("verified contracts are never flagged as lookalikes", () => {
      const verifiedAbi = detectLookalikeRisk({
        id: CONTRACT_ID,
        name: "USDC",
        is_verified: true,
      });
      assert.equal(verifiedAbi.is_lookalike, false);

      const verifiedOwnership = detectLookalikeRisk({
        id: CONTRACT_ID,
        name: "USDC Official",
        ownership_verified: true,
      });
      assert.equal(verifiedOwnership.is_lookalike, false);
    });

    it("flags exact unverified matches to verified identities", () => {
      const result = detectLookalikeRisk({
        id: CONTRACT_ID,
        name: "USDC",
        is_verified: false,
      });
      assert.equal(result.is_lookalike, true);
      assert.equal(result.resembles, "USDC");
      assert.equal(result.similarity_type, "exact_unverified");
      assert.equal(result.authoritative_contract_id, CONTRACT_ID);
      assert.ok(result.warning.includes("USDC"));
      assert.ok(result.warning.includes("authoritative Contract ID"));
    });

    it("flags homoglyph substitution lookalikes", () => {
      // USDС with Cyrillic С (U+0441)
      const result = detectLookalikeRisk({
        id: CONTRACT_ID,
        name: "USD\u0441",
        is_verified: false,
      });
      assert.equal(result.is_lookalike, true);
      assert.equal(result.resembles, "USDC");
      assert.equal(result.similarity_type, "homoglyph");
      assert.equal(result.authoritative_contract_id, CONTRACT_ID);
    });

    it("flags leetspeak substitution lookalikes", () => {
      const result = detectLookalikeRisk({
        id: CONTRACT_ID,
        name: "US0C",
        is_verified: false,
      });
      assert.equal(result.is_lookalike, true);
      assert.equal(result.resembles, "USDC");
      assert.equal(result.authoritative_contract_id, CONTRACT_ID);
    });

    it("flags impersonation suffix/prefix patterns", () => {
      const impersonations = [
        "USDC Official",
        "Circle USDC Airdrop",
        "Stellar Reward Foundation",
        "AQUA Claim Portal",
        "Blend Protocol Bonus",
      ];
      for (const name of impersonations) {
        const result = detectLookalikeRisk({
          id: CONTRACT_ID,
          name,
          is_verified: false,
        });
        assert.equal(result.is_lookalike, true, `Expected ${name} to be flagged`);
        assert.equal(result.similarity_type, "impersonation_suffix");
        assert.equal(result.authoritative_contract_id, CONTRACT_ID);
      }
    });

    it("flags typosquatting (1-2 distance edits)", () => {
      const typos = ["Stelllar", "Circlle", "Soroswapp", "Blendd"];
      for (const name of typos) {
        const result = detectLookalikeRisk({
          id: CONTRACT_ID,
          name,
          is_verified: false,
        });
        assert.equal(result.is_lookalike, true, `Expected ${name} to be flagged as typosquat`);
        assert.equal(result.similarity_type, "typosquat");
        assert.equal(result.authoritative_contract_id, CONTRACT_ID);
      }
    });

    it("handles explicit empty, invalid, and boundary inputs gracefully", () => {
      assert.equal(detectLookalikeRisk(null).is_lookalike, false);
      assert.equal(detectLookalikeRisk(undefined).is_lookalike, false);
      assert.equal(detectLookalikeRisk({}).is_lookalike, false);
      assert.equal(detectLookalikeRisk({ name: "" }).is_lookalike, false);
      assert.equal(detectLookalikeRisk({ name: "   " }).is_lookalike, false);
      assert.equal(detectLookalikeRisk({ name: null }).is_lookalike, false);
      assert.equal(detectLookalikeRisk({ name: 12345 }).is_lookalike, false);
      assert.equal(detectLookalikeRisk({ name: "!@#$%^" }).is_lookalike, false);
    });

    it("contains authoritative_contract_id in all warnings", () => {
      const result = detectLookalikeRisk({
        id: "CA111222333444",
        name: "USDC Giveaway",
      });
      assert.equal(result.is_lookalike, true);
      assert.equal(result.authoritative_contract_id, "CA111222333444");
    });
  });
});
