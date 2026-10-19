import React, { useState, useEffect } from "react";
import {
  SandboxCheckpoint,
  SandboxScenario,
  createCheckpoint,
  listCheckpoints,
  resetToCheckpoint,
  saveScenario,
} from "../services/sandbox-api";
import { SandboxFile } from "../services/webcontainer";

export interface CheckpointManagerProps {
  sandboxId: string;
  files: Map<string, SandboxFile>;
  onFilesReset: (newFiles: Map<string, SandboxFile>) => void;
  currentContractId?: string;
  currentFn?: string;
  currentArgs?: string;
  onLoadScenario?: (scenario: SandboxScenario) => void;
}

export const CheckpointManager: React.FC<CheckpointManagerProps> = ({
  sandboxId,
  files,
  onFilesReset,
  currentContractId = "",
  currentFn = "",
  currentArgs = "[]",
  onLoadScenario,
}) => {
  const [checkpoints, setCheckpoints] = useState<SandboxCheckpoint[]>([]);
  const [scenarios, setScenarios] = useState<SandboxScenario[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);

  const [checkpointName, setCheckpointName] = useState("");
  const [checkpointDesc, setCheckpointDesc] = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioDesc, setScenarioDesc] = useState("");
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string>("");

  const [confirmed, setConfirmed] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshData = async () => {
    if (!sandboxId) return;
    try {
      const data = await listCheckpoints(sandboxId);
      setCheckpoints(data.checkpoints || []);
      setScenarios(data.scenarios || []);
      if (data.checkpoints && data.checkpoints.length > 0 && !selectedCheckpointId) {
        setSelectedCheckpointId(data.checkpoints[0].id);
      }
    } catch (err: any) {
      console.warn("Failed to load checkpoints/scenarios:", err);
    }
  };

  useEffect(() => {
    refreshData();
  }, [sandboxId]);

  const handleCreateCheckpoint = async () => {
    if (!checkpointName.trim()) {
      setStatusMessage({ text: "Checkpoint name cannot be empty.", isError: true });
      return;
    }

    setBusy(true);
    setStatusMessage(null);
    try {
      const chk = await createCheckpoint(sandboxId, checkpointName.trim(), checkpointDesc.trim(), files);
      setCheckpoints((prev) => [...prev, chk]);
      setSelectedCheckpointId(chk.id);
      setShowCreateModal(false);
      setCheckpointName("");
      setCheckpointDesc("");
      setStatusMessage({ text: `✓ Created checkpoint "${chk.name}"` });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setStatusMessage({ text: `Failed to create checkpoint: ${err.message}`, isError: true });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!selectedCheckpointId) {
      setStatusMessage({ text: "Please select a checkpoint to reset to.", isError: true });
      return;
    }
    if (!confirmed) {
      setStatusMessage({ text: "Please confirm non-destructive reset.", isError: true });
      return;
    }

    setBusy(true);
    setStatusMessage(null);
    try {
      const result = await resetToCheckpoint(sandboxId, selectedCheckpointId);
      const targetCheckpoint = checkpoints.find((c) => c.id === selectedCheckpointId);
      const restoredMap = new Map<string, SandboxFile>(Object.entries(result.restoredFiles));
      onFilesReset(restoredMap);
      setShowResetModal(false);
      setConfirmed(false);
      setStatusMessage({
        text: `✓ Reset environment to "${targetCheckpoint?.name || selectedCheckpointId}". Retained ${result.retainedScenariosCount} saved scenario(s).`,
      });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      setStatusMessage({ text: `Failed to reset environment: ${err.message}`, isError: true });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveScenario = async () => {
    if (!scenarioName.trim()) {
      setStatusMessage({ text: "Scenario name cannot be empty.", isError: true });
      return;
    }

    setBusy(true);
    setStatusMessage(null);
    try {
      const sc = await saveScenario(sandboxId, {
        name: scenarioName.trim(),
        contractId: currentContractId,
        fn: currentFn,
        args: currentArgs,
        description: scenarioDesc.trim(),
      });
      setScenarios((prev) => [...prev, sc]);
      setShowScenarioModal(false);
      setScenarioName("");
      setScenarioDesc("");
      setStatusMessage({ text: `✓ Saved scenario "${sc.name}"` });
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setStatusMessage({ text: `Failed to save scenario: ${err.message}`, isError: true });
    } finally {
      setBusy(false);
    }
  };

  const handleSelectScenario = (sc: SandboxScenario) => {
    if (onLoadScenario) {
      onLoadScenario(sc);
      setStatusMessage({ text: `✓ Loaded scenario "${sc.name}"` });
      setTimeout(() => setStatusMessage(null), 2500);
    }
  };

  const selectedCheckpoint = checkpoints.find((c) => c.id === selectedCheckpointId);

  return (
    <div
      data-testid="checkpoint-manager"
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
        <strong>Environment Checkpoints & Scenarios</strong>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            onClick={() => {
              setShowCreateModal(true);
              setStatusMessage(null);
            }}
            style={{
              background: "transparent",
              border: "1px solid var(--border, #30363d)",
              color: "var(--text, #c9d1d9)",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            + Checkpoint
          </button>
          <button
            onClick={() => {
              setShowResetModal(true);
              setStatusMessage(null);
            }}
            disabled={checkpoints.length === 0}
            style={{
              background: checkpoints.length > 0 ? "rgba(210, 153, 34, 0.15)" : "transparent",
              border: "1px solid var(--border, #30363d)",
              color: checkpoints.length > 0 ? "#d29922" : "var(--muted, #8b949e)",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              cursor: checkpoints.length > 0 ? "pointer" : "not-allowed",
            }}
          >
            ↺ Reset Environment
          </button>
          <button
            onClick={() => {
              setShowScenarioModal(true);
              setStatusMessage(null);
            }}
            style={{
              background: "transparent",
              border: "1px solid var(--border, #30363d)",
              color: "var(--accent, #58a6ff)",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            + Scenario
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          style={{
            padding: "4px 8px",
            borderRadius: "4px",
            marginBottom: "8px",
            fontSize: "11px",
            backgroundColor: statusMessage.isError ? "rgba(244, 135, 113, 0.1)" : "rgba(63, 185, 80, 0.1)",
            color: statusMessage.isError ? "#f48771" : "var(--green, #3fb950)",
            border: `1px solid ${statusMessage.isError ? "#f48771" : "var(--green, #3fb950)"}`,
          }}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Checkpoints summary */}
      <div style={{ color: "var(--muted, #8b949e)", fontSize: "11px", marginBottom: "6px" }}>
        Checkpoints: {checkpoints.length} · Saved Scenarios: {scenarios.length}
      </div>

      {/* Scenarios Quick Load */}
      {scenarios.length > 0 && (
        <div style={{ marginTop: "6px", borderTop: "1px solid var(--border, #30363d)", paddingTop: "6px" }}>
          <div style={{ color: "var(--muted, #8b949e)", fontSize: "11px", marginBottom: "4px" }}>
            Saved Scenarios:
          </div>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {scenarios.map((sc) => (
              <button
                key={sc.id}
                onClick={() => handleSelectScenario(sc)}
                title={`Load ${sc.fn || "call"} on ${sc.contractId || "contract"}`}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border, #30363d)",
                  color: "var(--text, #c9d1d9)",
                  padding: "2px 6px",
                  borderRadius: "3px",
                  fontSize: "10px",
                  cursor: "pointer",
                }}
              >
                ▶ {sc.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Create Checkpoint */}
      {showCreateModal && (
        <div
          data-testid="create-checkpoint-modal"
          style={{
            marginTop: "8px",
            padding: "8px",
            border: "1px solid var(--border, #30363d)",
            borderRadius: "4px",
            backgroundColor: "var(--bg, #0d1117)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>Create Named Checkpoint</div>
          <input
            placeholder="Checkpoint name (e.g. After token deploy)"
            value={checkpointName}
            onChange={(e) => setCheckpointName(e.target.value)}
            style={{
              width: "100%",
              padding: "4px",
              fontSize: "11px",
              marginBottom: "4px",
              boxSizing: "border-box",
            }}
          />
          <input
            placeholder="Description (optional)"
            value={checkpointDesc}
            onChange={(e) => setCheckpointDesc(e.target.value)}
            style={{
              width: "100%",
              padding: "4px",
              fontSize: "11px",
              marginBottom: "6px",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
            <button onClick={() => setShowCreateModal(false)} style={{ fontSize: "11px" }}>
              Cancel
            </button>
            <button onClick={handleCreateCheckpoint} disabled={busy} style={{ fontSize: "11px" }}>
              Save Checkpoint
            </button>
          </div>
        </div>
      )}

      {/* Modal: Reset Confirmation Dialog */}
      {showResetModal && (
        <div
          data-testid="reset-checkpoint-modal"
          style={{
            marginTop: "8px",
            padding: "8px",
            border: "1px solid #d29922",
            borderRadius: "4px",
            backgroundColor: "var(--bg, #0d1117)",
          }}
        >
          <div style={{ fontWeight: 600, color: "#d29922", marginBottom: "4px" }}>
            ↺ Non-Destructive Environment Reset
          </div>
          <p style={{ color: "var(--text, #c9d1d9)", fontSize: "11px", marginBottom: "6px" }}>
            Reset sandbox files to a named checkpoint. <strong>Saved scenarios ({scenarios.length}) and all checkpoints ({checkpoints.length}) will be retained.</strong>
          </p>

          <div style={{ marginBottom: "6px" }}>
            <label style={{ display: "block", color: "var(--muted, #8b949e)", fontSize: "11px", marginBottom: "2px" }}>
              Target Checkpoint:
            </label>
            <select
              value={selectedCheckpointId}
              onChange={(e) => setSelectedCheckpointId(e.target.value)}
              style={{
                width: "100%",
                padding: "4px",
                fontSize: "11px",
                backgroundColor: "var(--surface, #161b22)",
                color: "var(--text, #c9d1d9)",
                border: "1px solid var(--border, #30363d)",
              }}
            >
              {checkpoints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({new Date(c.createdAt).toLocaleTimeString()})
                </option>
              ))}
            </select>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", margin: "6px 0" }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Confirm reset to checkpoint &quot;{selectedCheckpoint?.name}&quot;
          </label>

          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
            <button onClick={() => setShowResetModal(false)} style={{ fontSize: "11px" }}>
              Cancel
            </button>
            <button
              onClick={handleReset}
              disabled={busy || !confirmed || !selectedCheckpointId}
              style={{
                fontSize: "11px",
                backgroundColor: confirmed ? "#d29922" : "transparent",
                color: confirmed ? "#000" : "var(--muted, #8b949e)",
                fontWeight: 600,
              }}
            >
              Confirm & Reset
            </button>
          </div>
        </div>
      )}

      {/* Modal: Save Scenario */}
      {showScenarioModal && (
        <div
          data-testid="save-scenario-modal"
          style={{
            marginTop: "8px",
            padding: "8px",
            border: "1px solid var(--border, #30363d)",
            borderRadius: "4px",
            backgroundColor: "var(--bg, #0d1117)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>Save Current Scenario</div>
          <input
            placeholder="Scenario name (e.g. Mint 100 Tokens)"
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            style={{
              width: "100%",
              padding: "4px",
              fontSize: "11px",
              marginBottom: "4px",
              boxSizing: "border-box",
            }}
          />
          <input
            placeholder="Description (optional)"
            value={scenarioDesc}
            onChange={(e) => setScenarioDesc(e.target.value)}
            style={{
              width: "100%",
              padding: "4px",
              fontSize: "11px",
              marginBottom: "4px",
              boxSizing: "border-box",
            }}
          />
          <div style={{ color: "var(--muted, #8b949e)", fontSize: "10px", marginBottom: "6px" }}>
            Contract: {currentContractId || "none"} · Fn: {currentFn || "none"}
          </div>
          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
            <button onClick={() => setShowScenarioModal(false)} style={{ fontSize: "11px" }}>
              Cancel
            </button>
            <button onClick={handleSaveScenario} disabled={busy || !scenarioName.trim()} style={{ fontSize: "11px" }}>
              Save Scenario
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CheckpointManager;
