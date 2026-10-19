/**
 * Ledger-range comparison panel (#1030)
 * Compares event volume, active contracts and function mix across two ledger
 * ranges on the active network. Scans the most recent events only, so ranges
 * older than that window show partial data and say so.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useNetwork } from "../contexts/NetworkContext";
import {
  compareLedgerRanges,
  validateLedgerRange,
  type LedgerRange,
} from "../utils/ledgerRangeComparison";

const SCAN_LIMIT = 200;

const inputStyle = { width: 120, padding: "4px 6px", fontSize: 13 } as const;

function parseBound(raw: string): number {
  return raw.trim() === "" ? Number.NaN : Number(raw);
}

export default function LedgerRangeComparison({ contractId }: { contractId?: string }) {
  const { active } = useNetwork();
  const [startA, setStartA] = useState("");
  const [endA, setEndA] = useState("");
  const [startB, setStartB] = useState("");
  const [endB, setEndB] = useState("");
  const [submitted, setSubmitted] = useState<{ a: LedgerRange; b: LedgerRange } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["ledger-range-scan", contractId ?? "all", active.id],
    queryFn: () => api.events({ contract: contractId, limit: SCAN_LIMIT }),
    enabled: submitted !== null,
  });

  function handleCompare() {
    const a = { start: parseBound(startA), end: parseBound(endA) };
    const b = { start: parseBound(startB), end: parseBound(endB) };
    const invalid = [a, b].map(validateLedgerRange).find((r) => !r.ok);
    if (invalid && !invalid.ok) {
      setFormError(invalid.error);
      setSubmitted(null);
      return;
    }
    setFormError(null);
    setSubmitted({ a, b });
  }

  const events = data?.data ?? [];
  const comparison = submitted ? compareLedgerRanges(events, submitted.a, submitted.b) : null;
  const oldestScanned = events.length > 0 ? Math.min(...events.map((e) => e.ledger)) : null;
  const partial =
    comparison && oldestScanned !== null && (comparison.a.range.start < oldestScanned || comparison.b.range.start < oldestScanned);

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div>
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>Ledger-range comparison</h3>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Network: <strong style={{ color: "var(--text)" }}>{active.name}</strong>
          {contractId && <> · Contract: <span style={{ fontFamily: "monospace" }}>{contractId}</span></>}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        {(["A", "B"] as const).map((label) => {
          const [start, end, setStart, setEnd] =
            label === "A" ? [startA, endA, setStartA, setEndA] : [startB, endB, setStartB, setEndB];
          return (
            <fieldset key={label} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <legend style={{ fontSize: 12 }}>Range {label}</legend>
              <label style={{ fontSize: 12, display: "grid", gap: 2 }}>
                Start ledger
                <input aria-label={`Range ${label} start ledger`} inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ fontSize: 12, display: "grid", gap: 2 }}>
                End ledger
                <input aria-label={`Range ${label} end ledger`} inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
              </label>
            </fieldset>
          );
        })}
        <button type="button" onClick={handleCompare}>
          Compare
        </button>
      </div>

      {formError && <p role="alert" style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>{formError}</p>}
      {submitted && isLoading && <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Scanning recent events…</p>}
      {submitted && error && <p style={{ color: "#ef4444", fontSize: 13, margin: 0 }}>Failed to load events for comparison.</p>}

      {comparison && !isLoading && !error && (
        <>
          {partial && (
            <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
              Only the latest {SCAN_LIMIT} events were scanned (oldest ledger {oldestScanned?.toLocaleString()}); counts for earlier ranges are partial.
            </p>
          )}
          {events.length === 0 && (
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>No events were returned to compare.</p>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: 6 }}>Metric</th>
                  <th style={{ padding: 6 }}>Range A ({comparison.a.range.start.toLocaleString()}–{comparison.a.range.end.toLocaleString()})</th>
                  <th style={{ padding: 6 }}>Range B ({comparison.b.range.start.toLocaleString()}–{comparison.b.range.end.toLocaleString()})</th>
                  <th style={{ padding: 6 }}>Δ (B − A)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: 6 }}>Events</td>
                  <td style={{ padding: 6 }}>{comparison.a.eventCount}</td>
                  <td style={{ padding: 6 }}>{comparison.b.eventCount}</td>
                  <td style={{ padding: 6 }}>{comparison.eventDelta}</td>
                </tr>
                <tr>
                  <td style={{ padding: 6 }}>Active contracts</td>
                  <td style={{ padding: 6 }}>{comparison.a.activeContracts}</td>
                  <td style={{ padding: 6 }}>{comparison.b.activeContracts}</td>
                  <td style={{ padding: 6 }}>{comparison.contractDelta}</td>
                </tr>
                {comparison.functions.map((row) => (
                  <tr key={row.fn}>
                    <td style={{ padding: 6, fontFamily: "monospace" }}>fn: {row.fn}</td>
                    <td style={{ padding: 6 }}>{row.a}</td>
                    <td style={{ padding: 6 }}>{row.b}</td>
                    <td style={{ padding: 6 }}>{row.b - row.a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
