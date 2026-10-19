import type { DecodedEvent } from "../api";

/**
 * Why an event's fields could not be fully decoded (#1036). Each state gets its
 * own label so users can tell "no ABI was registered" apart from "the ABI
 * exists but this value is unsupported or malformed".
 *
 * - decoded:          fully decoded and verified against the ABI
 * - unknown_abi:      no ABI metadata for this contract, so fields are heuristic
 * - partial:          an ABI exists but does not describe this function
 * - unsupported_type: a field's XDR type is not supported by the decoder
 * - malformed:        the value does not match the on-chain spec
 */
export type DecodeState = "decoded" | "unknown_abi" | "partial" | "unsupported_type" | "malformed";

export type DecodeFields = Pick<DecodedEvent, "decode_source" | "decode_status" | "decode_warnings">;

const UNSUPPORTED_RE = /unsupported/i;

export function classifyDecodeState(ev: DecodeFields): DecodeState {
  if (ev.decode_warnings?.some((w) => UNSUPPORTED_RE.test(w))) return "unsupported_type";
  if (ev.decode_source === "spec_mismatch") return "malformed";
  if (ev.decode_status === "heuristic") return "unknown_abi";
  if (ev.decode_status === "unverified") return "partial";
  return "decoded";
}

/** Short badge label and explanatory tooltip for a non-decoded state. */
export const DECODE_STATE_LABELS: Record<Exclude<DecodeState, "decoded">, { label: string; title: string }> = {
  unknown_abi: {
    label: "Unknown ABI",
    title: "No ABI is registered for this contract, so fields were decoded heuristically",
  },
  partial: {
    label: "Partially decoded",
    title: "The contract ABI does not describe this function; only some fields could be decoded",
  },
  unsupported_type: {
    label: "Unsupported type",
    title: "A field uses an XDR type this explorer cannot decode yet",
  },
  malformed: {
    label: "Malformed value",
    title: "The value does not match the on-chain contract spec",
  },
};
