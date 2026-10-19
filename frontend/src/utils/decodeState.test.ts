import { describe, it, expect } from "vitest";
import { classifyDecodeState, DECODE_STATE_LABELS } from "./decodeState";

describe("classifyDecodeState", () => {
  it("reports fully verified events as decoded", () => {
    expect(classifyDecodeState({ decode_status: "verified", decode_source: "abi" })).toBe("decoded");
  });

  it("reports heuristic events with no ABI as unknown_abi", () => {
    expect(classifyDecodeState({ decode_status: "heuristic", decode_source: "heuristic" })).toBe("unknown_abi");
  });

  it("reports events whose ABI does not describe the function as partial", () => {
    expect(classifyDecodeState({ decode_status: "unverified", decode_source: "abi" })).toBe("partial");
  });

  it("reports spec mismatches as malformed", () => {
    expect(classifyDecodeState({ decode_status: "unverified", decode_source: "spec_mismatch" })).toBe("malformed");
  });

  it("reports unsupported XDR types from decoder warnings, whatever the status", () => {
    expect(
      classifyDecodeState({
        decode_status: "verified",
        decode_source: "abi",
        decode_warnings: ["field 'memo': unsupported XDR type MuxedAccount"],
      }),
    ).toBe("unsupported_type");
  });

  it("gives unsupported type precedence over a spec mismatch", () => {
    expect(
      classifyDecodeState({
        decode_source: "spec_mismatch",
        decode_status: "unverified",
        decode_warnings: ["Unsupported ScVal"],
      }),
    ).toBe("unsupported_type");
  });

  it("treats events with no decode metadata as decoded rather than guessing", () => {
    expect(classifyDecodeState({})).toBe("decoded");
  });

  it("has a label for every non-decoded state", () => {
    for (const key of ["unknown_abi", "partial", "unsupported_type", "malformed"] as const) {
      expect(DECODE_STATE_LABELS[key].label).not.toBe("");
      expect(DECODE_STATE_LABELS[key].title).not.toBe("");
    }
  });
});
