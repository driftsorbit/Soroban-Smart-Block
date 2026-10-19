/**
 * Side-by-side raw XDR and decoded view helpers (#1032).
 * Flattens the decoded event into copyable field paths and links each path to
 * the raw XDR block it was decoded from, so hovering one side can highlight
 * the other. Pure functions only.
 */
import type { DecodedEvent } from "../api";

export interface FieldPath {
  path: string;
  value: string;
}

export interface RawBlock {
  /** Stable key shared with `linkDecodedToRaw`, e.g. "raw_topics[0]" or "raw_data". */
  key: string;
  value: string;
}

/** Flattens nested objects and arrays into leaf paths such as `heuristic_params[0].value`. */
export function flattenFieldPaths(value: unknown, path = ""): FieldPath[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [{ path: path || "$", value: "[]" }];
    return value.flatMap((item, i) => flattenFieldPaths(item, `${path}[${i}]`));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return [{ path: path || "$", value: "{}" }];
    return entries.flatMap(([key, child]) => flattenFieldPaths(child, path ? `${path}.${key}` : key));
  }
  return [{ path: path || "$", value: String(value) }];
}

/** The decoded view shown on the right-hand side of the split. */
export function decodedView(ev: Pick<DecodedEvent, "function" | "description" | "heuristic_params">) {
  return {
    function: ev.function,
    description: ev.description,
    heuristic_params: ev.heuristic_params ?? [],
  };
}

/** The raw XDR blocks shown on the left-hand side, in order. */
export function rawBlocks(ev: Pick<DecodedEvent, "raw_topics" | "raw_data">): RawBlock[] {
  const blocks = ev.raw_topics.map((value, i) => ({ key: `raw_topics[${i}]`, value }));
  if (ev.raw_data) blocks.push({ key: "raw_data", value: ev.raw_data });
  return blocks;
}

/**
 * Maps decoded field paths to the raw block key they were read from.
 * Paths with no traceable source are left out of the map.
 */
export function linkDecodedToRaw(
  ev: Pick<DecodedEvent, "raw_topics" | "raw_data" | "heuristic_params">,
): Record<string, string> {
  const links: Record<string, string> = {};
  if (ev.raw_topics.length > 0) links["function"] = "raw_topics[0]";
  if (ev.raw_data) links["description"] = "raw_data";

  const blocks = rawBlocks(ev);
  (ev.heuristic_params ?? []).forEach((param, i) => {
    const source = blocks.find((b) => b.value === param.raw);
    if (!source) return;
    links[`heuristic_params[${i}].raw`] = source.key;
    links[`heuristic_params[${i}].value`] = source.key;
  });
  return links;
}
