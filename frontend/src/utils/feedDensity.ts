import { ROW_HEIGHT } from "../hooks/useVirtualList";

/**
 * Event-feed layout density (#1035). "comfortable" is the default readable
 * layout; "compact" packs more rows per screen for analysts.
 */
export type FeedDensity = "comfortable" | "compact";

/** Row height in pixels for each density. Compact rows still fit one line of text. */
export const COMPACT_ROW_HEIGHT = 34;

/** Parse the `density` query parameter, falling back to comfortable for anything unknown. */
export function parseFeedDensity(value: string | null | undefined): FeedDensity {
  return value === "compact" ? "compact" : "comfortable";
}

/** Fixed virtual-row height for a density. */
export function feedRowHeight(density: FeedDensity): number {
  return density === "compact" ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
}
