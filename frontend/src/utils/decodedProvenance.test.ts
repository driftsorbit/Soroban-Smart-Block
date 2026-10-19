import { describe, it, expect } from "vitest";
import { buildDecodedProvenance, describeDecodeSource } from "./decodedProvenance";

const base = {
  function: "transfer",
  description: "Transferred 5 USDC",
  raw_topics: ["AAAADwAAAAh0cmFuc2Zlcg=="],
  raw_data: "AAAACg==",
  heuristic_params: undefined,
  decode_source: "abi" as const,
};

describe("describeDecodeSource", () => {
  it("maps each known decoder source to a rule label", () => {
    expect(describeDecodeSource("abi")).toBe("Registered ABI");
    expect(describeDecodeSource("spec")).toBe("On-chain contract spec");
    expect(describeDecodeSource("spec_mismatch")).toBe("On-chain spec (event shape did not match)");
    expect(describeDecodeSource("heuristic")).toBe("Heuristic guess (no ABI registered)");
  });

  it("labels a missing source as unknown instead of guessing", () => {
    expect(describeDecodeSource(null)).toBe("Unknown (decoder did not record a source)");
    expect(describeDecodeSource(undefined)).toBe("Unknown (decoder did not record a source)");
  });
});

describe("buildDecodedProvenance", () => {
  it("attributes function and description to the registered ABI with their source fields", () => {
    const { rows } = buildDecodedProvenance(base);
    expect(rows).toEqual([
      { field: "Function", value: "transfer", rule: "Registered ABI", sourceField: "raw_topics[0]" },
      { field: "Description", value: "Transferred 5 USDC", rule: "Registered ABI", sourceField: "raw_data" },
    ]);
  });

  it("points description at raw_topics when there is no raw_data", () => {
    const { rows } = buildDecodedProvenance({ ...base, raw_data: undefined });
    expect(rows.find((r) => r.field === "Description")?.sourceField).toBe("raw_topics");
  });

  it("explains heuristic arguments with their type, confidence and raw source", () => {
    const { rows } = buildDecodedProvenance({
      ...base,
      decode_source: "heuristic",
      heuristic_params: [{ index: 1, raw: "AAAAEQ==", type: "Amount", value: "5 USDC", confidence: "likely" }],
    });
    expect(rows).toContainEqual({
      field: "Argument 1",
      value: "5 USDC",
      rule: "Heuristic Amount (likely)",
      sourceField: "arg[1] = AAAAEQ==",
    });
  });

  it("reports the ABI version as unrecorded by default", () => {
    expect(buildDecodedProvenance(base).abiVersion).toBeNull();
  });

  it("carries a known ABI version through", () => {
    expect(buildDecodedProvenance(base, 3).abiVersion).toBe(3);
  });

  it("returns no rows for an event with nothing decoded", () => {
    const { rows } = buildDecodedProvenance({
      function: "",
      description: "",
      raw_topics: [],
      decode_source: null,
    });
    expect(rows).toEqual([]);
  });
});
