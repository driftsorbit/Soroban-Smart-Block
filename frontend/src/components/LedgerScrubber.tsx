/**
 * LedgerScrubber (#1033)
 * Moves a window through the ledger interval covered by the loaded events and
 * shows event density across it. Works only on the events it is given, which
 * are already filtered, so active filters are kept as they are.
 */
import { useState } from "react";
import type { DecodedEvent } from "../api";
import { binEventsByLedger, clampLedger, eventsInWindow, intervalOf, stepLedger } from "../utils/ledgerScrubber";

const WINDOW_OPTIONS = [1, 10, 100] as const;
const BINS = 60;
const MAX_LISTED = 20;

export default function LedgerScrubber({ events }: { events: DecodedEvent[] }) {
  const [position, setPosition] = useState<number | null>(null);
  const [windowSize, setWindowSize] = useState<(typeof WINDOW_OPTIONS)[number]>(10);

  const interval = intervalOf(events);
  if (!interval) return null;

  const from = clampLedger(position ?? interval.start, interval);
  const to = Math.min(interval.end, from + windowSize - 1);
  const counts = binEventsByLedger(events, interval, BINS);
  const peak = Math.max(1, ...counts);
  const inWindow = eventsInWindow(events, from, windowSize);
  const span = interval.end - interval.start + 1;

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <h4 style={{ fontSize: 13, margin: 0 }}>Ledger scrubber</h4>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Interval {interval.start.toLocaleString()}–{interval.end.toLocaleString()} · window {from.toLocaleString()}–{to.toLocaleString()}
        </span>
      </div>

      {/* Event density across the interval; clicking a bar jumps the window there */}
      <div
        role="img"
        aria-label={`Event density across ledgers ${interval.start}–${interval.end}`}
        style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 48 }}
      >
        {counts.map((count, i) => {
          const bucketStart = interval.start + Math.floor((i * span) / BINS);
          const active = bucketStart <= to && bucketStart + Math.ceil(span / BINS) - 1 >= from;
          return (
            <button
              key={i}
              type="button"
              aria-label={`${count} events starting at ledger ${bucketStart}`}
              onClick={() => setPosition(clampLedger(bucketStart, interval))}
              style={{
                flex: 1,
                minWidth: 0,
                padding: 0,
                height: `${Math.max(2, (count / peak) * 100)}%`,
                background: active ? "var(--primary)" : "var(--muted)",
                opacity: count === 0 ? 0.25 : 1,
                border: "none",
                cursor: "pointer",
              }}
            />
          );
        })}
      </div>

      <input
        type="range"
        aria-label="Window start ledger"
        min={interval.start}
        max={interval.end}
        value={from}
        onChange={(e) => setPosition(Number(e.target.value))}
        disabled={interval.start === interval.end}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12 }}>
        <button type="button" onClick={() => setPosition(stepLedger(from, -windowSize, interval))} disabled={from <= interval.start}>
          ◀ Earlier
        </button>
        <button type="button" onClick={() => setPosition(stepLedger(from, windowSize, interval))} disabled={to >= interval.end}>
          Later ▶
        </button>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          Window
          <select value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value) as (typeof WINDOW_OPTIONS)[number])}>
            {WINDOW_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} ledger{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <span style={{ color: "var(--muted)" }}>
          {inWindow.length} event{inWindow.length === 1 ? "" : "s"} in window
        </span>
      </div>

      {inWindow.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>No events in this window.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: "grid", gap: 2 }}>
          {inWindow.slice(0, MAX_LISTED).map((e) => (
            <li key={e.seq}>
              Ledger {e.ledger.toLocaleString()} · {e.function || "unknown function"}
            </li>
          ))}
          {inWindow.length > MAX_LISTED && (
            <li style={{ color: "var(--muted)" }}>…and {inWindow.length - MAX_LISTED} more</li>
          )}
        </ul>
      )}
    </div>
  );
}
