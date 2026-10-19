import React from "react";
import { SimulationBudgetDeltas as BudgetDeltasType, ResourceBudget, BudgetDelta } from "../services/sandbox-api";

export interface SimulationBudgetDeltasProps {
  currentBudget: ResourceBudget | null;
  deltas?: BudgetDeltasType | null;
  mode?: "remote" | "local";
  error?: string;
}

function formatDelta(delta: BudgetDelta | undefined, unit: string = ""): { text: string; color: string; badge: string } {
  if (!delta || delta.status === "unavailable") {
    return { text: "Unavailable from RPC", color: "var(--muted, #8b949e)", badge: "N/A" };
  }
  if (delta.status === "baseline") {
    return { text: "Baseline run", color: "var(--accent, #58a6ff)", badge: "Baseline" };
  }
  if (delta.diff === null) {
    return { text: "Unavailable from RPC", color: "var(--muted, #8b949e)", badge: "N/A" };
  }

  const sign = delta.diff > 0 ? "+" : "";
  const pct = delta.percent !== null ? ` (${sign}${delta.percent.toFixed(1)}%)` : "";
  const text = `${sign}${delta.diff.toLocaleString()}${unit ? ` ${unit}` : ""}${pct}`;

  // For CPU, memory, fee: diff > 0 means increased resource consumption
  if (delta.diff > 0) {
    return { text, color: "#f48771", badge: "▲ Increase" };
  }
  if (delta.diff < 0) {
    return { text, color: "var(--green, #3fb950)", badge: "▼ Saved" };
  }
  return { text: `0${unit ? ` ${unit}` : ""} (0.0%)`, color: "var(--muted, #8b949e)", badge: "— Unchanged" };
}

export const SimulationBudgetDeltas: React.FC<SimulationBudgetDeltasProps> = ({
  currentBudget,
  deltas,
  mode = "remote",
  error,
}) => {
  // Explicit empty state
  if (!currentBudget) {
    return (
      <div
        data-testid="budget-deltas-empty"
        style={{
          border: "1px dashed var(--border, #30363d)",
          borderRadius: "6px",
          padding: "10px",
          color: "var(--muted, #8b949e)",
          fontSize: "12px",
          fontStyle: "italic",
          margin: "6px 0",
        }}
      >
        No simulation resource-budget data yet. Run a simulation to measure CPU, memory, ledger I/O, and fee deltas.
      </div>
    );
  }

  const cpuDelta = formatDelta(deltas?.cpu, "insns");
  const memDelta = formatDelta(deltas?.mem, "bytes");
  const ledgerReadDelta = formatDelta(deltas?.ledgerReadBytes, "bytes");
  const ledgerWriteDelta = formatDelta(deltas?.ledgerWriteBytes, "bytes");
  const feeDelta = formatDelta(deltas?.fee, "stroops");

  return (
    <div
      data-testid="budget-deltas-panel"
      style={{
        border: "1px solid var(--border, #30363d)",
        borderRadius: "6px",
        padding: "10px",
        backgroundColor: "var(--surface, #161b22)",
        fontSize: "12px",
        margin: "6px 0",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <strong>Resource Budget & Deltas ({mode})</strong>
        {deltas?.cpu.status === "baseline" && (
          <span
            style={{
              fontSize: "10px",
              padding: "2px 6px",
              borderRadius: "4px",
              backgroundColor: "rgba(88, 166, 255, 0.15)",
              color: "var(--accent, #58a6ff)",
            }}
          >
            Baseline Run
          </span>
        )}
      </div>

      {error && (
        <div style={{ color: "#f48771", marginBottom: "8px", fontSize: "11px" }}>
          ⚠ Simulation failed: {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        {/* CPU */}
        <div style={{ border: "1px solid var(--border, #30363d)", borderRadius: "4px", padding: "6px" }}>
          <div style={{ color: "var(--muted, #8b949e)", fontSize: "11px" }}>CPU Instructions</div>
          <div style={{ fontWeight: 600, fontSize: "13px" }}>{currentBudget.cpuInsns.toLocaleString()}</div>
          <div style={{ fontSize: "11px", color: cpuDelta.color, marginTop: "2px" }}>
            Δ {cpuDelta.text}
          </div>
        </div>

        {/* Memory */}
        <div style={{ border: "1px solid var(--border, #30363d)", borderRadius: "4px", padding: "6px" }}>
          <div style={{ color: "var(--muted, #8b949e)", fontSize: "11px" }}>Memory</div>
          <div style={{ fontWeight: 600, fontSize: "13px" }}>{currentBudget.memBytes.toLocaleString()} B</div>
          <div style={{ fontSize: "11px", color: memDelta.color, marginTop: "2px" }}>
            Δ {memDelta.text}
          </div>
        </div>

        {/* Ledger I/O */}
        <div style={{ border: "1px solid var(--border, #30363d)", borderRadius: "4px", padding: "6px" }}>
          <div style={{ color: "var(--muted, #8b949e)", fontSize: "11px" }}>Ledger I/O (Read / Write)</div>
          {currentBudget.ledgerIOUnavailable || !currentBudget.ledgerIO ? (
            <div>
              <span
                style={{
                  fontSize: "10px",
                  padding: "1px 5px",
                  borderRadius: "3px",
                  backgroundColor: "rgba(210, 153, 34, 0.15)",
                  color: "#d29922",
                }}
              >
                {mode === "local" ? "Unavailable in local mode" : "Unavailable from RPC"}
              </span>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 600, fontSize: "12px" }}>
                {currentBudget.ledgerIO.readBytes} B read · {currentBudget.ledgerIO.writeBytes} B write
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted, #8b949e)" }}>
                Entries: {currentBudget.ledgerIO.readEntries} R · {currentBudget.ledgerIO.writeEntries} W
              </div>
              <div style={{ fontSize: "11px", color: ledgerReadDelta.color, marginTop: "2px" }}>
                Δ Read: {ledgerReadDelta.text}
              </div>
              <div style={{ fontSize: "11px", color: ledgerWriteDelta.color }}>
                Δ Write: {ledgerWriteDelta.text}
              </div>
            </div>
          )}
        </div>

        {/* Min Resource Fee */}
        <div style={{ border: "1px solid var(--border, #30363d)", borderRadius: "4px", padding: "6px" }}>
          <div style={{ color: "var(--muted, #8b949e)", fontSize: "11px" }}>Min Resource Fee</div>
          {currentBudget.feeUnavailable || currentBudget.minResourceFee == null ? (
            <div>
              <span
                style={{
                  fontSize: "10px",
                  padding: "1px 5px",
                  borderRadius: "3px",
                  backgroundColor: "rgba(210, 153, 34, 0.15)",
                  color: "#d29922",
                }}
              >
                {mode === "local" ? "Unavailable in local mode" : "Unavailable from RPC"}
              </span>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 600, fontSize: "13px" }}>
                {Number(currentBudget.minResourceFee).toLocaleString()} stroops
              </div>
              <div style={{ fontSize: "11px", color: feeDelta.color, marginTop: "2px" }}>
                Δ {feeDelta.text}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SimulationBudgetDeltas;
