/**
 * Decoded-value provenance (#1031)
 * Explains which decoder rule produced each human-readable value on an event
 * and which raw source field it came from. Pure function, no I/O.
 */
import type { DecodedEvent } from "../api";

type ProvenanceEvent = Pick<
  DecodedEvent,
  "decode_source" | "function" | "description" | "raw_topics" | "raw_data" | "heuristic_params"
>;

export interface ProvenanceRow {
  field: string;
  value: string;
  rule: string;
  sourceField: string;
}

export interface DecodedProvenance {
  /** Null when the event does not record which ABI version decoded it. */
  abiVersion: number | null;
  rows: ProvenanceRow[];
}

const SOURCE_RULE: Record<NonNullable<DecodedEvent["decode_source"]>, string> = {
  abi: "Registered ABI",
  spec: "On-chain contract spec",
  spec_mismatch: "On-chain spec (event shape did not match)",
  heuristic: "Heuristic guess (no ABI registered)",
};

const UNKNOWN_RULE = "Unknown (decoder did not record a source)";

export function describeDecodeSource(source: DecodedEvent["decode_source"]): string {
  return source ? SOURCE_RULE[source] : UNKNOWN_RULE;
}

export function buildDecodedProvenance(ev: ProvenanceEvent, abiVersion: number | null = null): DecodedProvenance {
  const sourceRule = describeDecodeSource(ev.decode_source);
  const rows: ProvenanceRow[] = [];

  if (ev.function) {
    rows.push({ field: "Function", value: ev.function, rule: sourceRule, sourceField: "raw_topics[0]" });
  }

  for (const param of ev.heuristic_params ?? []) {
    rows.push({
      field: `Argument ${param.index}`,
      value: param.value,
      rule: `Heuristic ${param.type} (${param.confidence})`,
      sourceField: `arg[${param.index}] = ${param.raw}`,
    });
  }

  if (ev.description) {
    rows.push({
      field: "Description",
      value: ev.description,
      rule: sourceRule,
      sourceField: ev.raw_data ? "raw_data" : "raw_topics",
    });
  }

  return { abiVersion, rows };
}
