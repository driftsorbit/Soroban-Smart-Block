import { describe, it, expect } from "vitest";
import {
  jsonToScVal,
  scValToJson,
  verifyRoundTrip,
  TEST_VECTOR_PRESETS,
  ValueType,
} from "../src/utils/testVectors";
import { xdr, Address } from "@stellar/stellar-sdk";

describe("Soroban Value Types Test Vectors (#1097)", () => {
  describe("Primitives Round-trip", () => {
    it("round-trips booleans (true and false)", () => {
      expect(verifyRoundTrip("bool", true).ok).toBe(true);
      expect(verifyRoundTrip("bool", true).roundTripValue).toBe(true);
      expect(verifyRoundTrip("bool", false).ok).toBe(true);
      expect(verifyRoundTrip("bool", false).roundTripValue).toBe(false);
    });

    it("round-trips u32 within bounds", () => {
      const res = verifyRoundTrip("u32", 4294967295);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(4294967295);

      const zero = verifyRoundTrip("u32", 0);
      expect(zero.ok).toBe(true);
      expect(zero.roundTripValue).toBe(0);
    });

    it("rejects invalid u32 (negative or overflow)", () => {
      expect(verifyRoundTrip("u32", -1).ok).toBe(false);
      expect(verifyRoundTrip("u32", 4294967296).ok).toBe(false);
    });

    it("round-trips i32 within bounds", () => {
      const neg = verifyRoundTrip("i32", -2147483648);
      expect(neg.ok).toBe(true);
      expect(neg.roundTripValue).toBe(-2147483648);

      const pos = verifyRoundTrip("i32", 2147483647);
      expect(pos.ok).toBe(true);
      expect(pos.roundTripValue).toBe(2147483647);
    });

    it("round-trips u64 large numbers", () => {
      const maxU64 = "18446744073709551615";
      const res = verifyRoundTrip("u64", maxU64);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(maxU64);
    });

    it("round-trips i64 negative numbers", () => {
      const minI64 = "-9223372036854775808";
      const res = verifyRoundTrip("i64", minI64);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(minI64);
    });

    it("round-trips u128 large numbers", () => {
      const maxU128 = "340282366920938463463374607431768211455";
      const res = verifyRoundTrip("u128", maxU128);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(maxU128);
    });

    it("round-trips i128 large numbers", () => {
      const minI128 = "-170141183460469231731687303715884105728";
      const res = verifyRoundTrip("i128", minI128);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(minI128);
    });

    it("round-trips UTF-8 strings", () => {
      const text = "Hello, Soroban smart contract!";
      const res = verifyRoundTrip("string", text);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(text);
    });

    it("round-trips symbols (<= 32 chars)", () => {
      const sym = "transfer_token";
      const res = verifyRoundTrip("symbol", sym);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(sym);
    });

    it("rejects symbols longer than 32 characters", () => {
      const longSym = "a".repeat(33);
      expect(verifyRoundTrip("symbol", longSym).ok).toBe(false);
    });

    it("round-trips hex byte strings", () => {
      const hex = "deadbeefcafe1234";
      const res = verifyRoundTrip("bytes", hex);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(hex);
    });

    it("rejects invalid hex byte strings", () => {
      expect(verifyRoundTrip("bytes", "not_hex_zz").ok).toBe(false);
    });
  });

  describe("Vectors, Maps, and Structs", () => {
    it("round-trips numeric and string vectors", () => {
      const vec1 = [1, 2, 3, 4];
      const res1 = verifyRoundTrip("vec", vec1);
      expect(res1.ok).toBe(true);
      expect(res1.roundTripValue).toEqual(vec1);

      const empty: any[] = [];
      const resEmpty = verifyRoundTrip("vec", empty);
      expect(resEmpty.ok).toBe(true);
      expect(resEmpty.roundTripValue).toEqual([]);
    });

    it("round-trips maps with key-values", () => {
      const mapVal = { allowance: 1000, limit: 5000 };
      const res = verifyRoundTrip("map", mapVal);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toEqual(mapVal);
    });

    it("round-trips structs represented as composite maps", () => {
      const structVal = { decimals: 7, name: "Stellar" };
      const res = verifyRoundTrip("struct", structVal);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toEqual(structVal);
    });
  });

  describe("Enums and Addresses", () => {
    it("converts unit enum variant to ScVal", () => {
      const scVal = jsonToScVal("enum", { variant: "Active" });
      expect(scVal.switch()).toBe(xdr.ScValType.scvVec());
      const vec = scVal.vec() || [];
      expect(vec.length).toBe(1);
      expect(vec[0].sym().toString()).toBe("Active");
    });

    it("converts tuple/data enum variant to ScVal with payload", () => {
      const scVal = jsonToScVal("enum", { variant: "Transfer", values: [100, "XLM"] });
      const vec = scVal.vec() || [];
      expect(vec.length).toBe(3);
      expect(vec[0].sym().toString()).toBe("Transfer");
      expect(vec[1].i32()).toBe(100);
      expect(vec[2].str().toString()).toBe("XLM");
    });

    it("round-trips Stellar Account G... address", () => {
      const addr = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
      const res = verifyRoundTrip("address", addr);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(addr);
    });

    it("round-trips Soroban Contract C... address", () => {
      const contractAddr = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
      const res = verifyRoundTrip("address", contractAddr);
      expect(res.ok).toBe(true);
      expect(res.roundTripValue).toBe(contractAddr);
    });

    it("rejects invalid address format or bad checksum", () => {
      expect(verifyRoundTrip("address", "GINVALID").ok).toBe(false);
      expect(verifyRoundTrip("address", "123456").ok).toBe(false);
    });
  });

  describe("Preset Vector Integrity", () => {
    it("has presets covering primitive, vector, map, struct, enum, and address", () => {
      const categories = new Set(TEST_VECTOR_PRESETS.map((p) => p.category));
      expect(categories.has("primitive")).toBe(true);
      expect(categories.has("vector")).toBe(true);
      expect(categories.has("map")).toBe(true);
      expect(categories.has("struct")).toBe(true);
      expect(categories.has("enum")).toBe(true);
      expect(categories.has("address")).toBe(true);
    });

    it("all preset JSON values parse cleanly and convert to valid ScVal", () => {
      for (const preset of TEST_VECTOR_PRESETS) {
        const parsed = JSON.parse(preset.defaultJson);
        const scVal = jsonToScVal(preset.type, parsed);
        expect(scVal).toBeDefined();
        const b64 = scVal.toXDR("base64");
        expect(typeof b64).toBe("string");
        expect(b64.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Empty and Failure Boundaries", () => {
    it("handles empty values with explicit error", () => {
      expect(verifyRoundTrip("u32", "").ok).toBe(false);
      expect(verifyRoundTrip("u32", undefined).ok).toBe(false);
    });
  });
});
