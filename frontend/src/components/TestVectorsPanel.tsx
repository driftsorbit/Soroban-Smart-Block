import React, { useState } from "react";
import {
  TEST_VECTOR_PRESETS,
  TestVectorPreset,
  ValueType,
  verifyRoundTrip,
} from "../utils/testVectors";

export interface TestVectorsPanelProps {
  onSelectVector?: (jsonStr: string) => void;
}

export const TestVectorsPanel: React.FC<TestVectorsPanelProps> = ({ onSelectVector }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("primitive");
  const [selectedPresetId, setSelectedPresetId] = useState<string>(TEST_VECTOR_PRESETS[0].id);
  const [editedJson, setEditedJson] = useState<string>(TEST_VECTOR_PRESETS[0].defaultJson);
  const [applied, setApplied] = useState(false);

  const categories = ["primitive", "vector", "map", "struct", "enum", "address"];
  const currentCategoryPresets = TEST_VECTOR_PRESETS.filter((p) => p.category === selectedCategory);
  const currentPreset = TEST_VECTOR_PRESETS.find((p) => p.id === selectedPresetId) || currentCategoryPresets[0];

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    const firstInCat = TEST_VECTOR_PRESETS.find((p) => p.category === cat);
    if (firstInCat) {
      setSelectedPresetId(firstInCat.id);
      setEditedJson(firstInCat.defaultJson);
    }
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const p = TEST_VECTOR_PRESETS.find((item) => item.id === presetId);
    if (p) {
      setEditedJson(p.defaultJson);
    }
  };

  // Perform live round-trip test on edited value
  let roundTripResult: { ok: boolean; roundTripValue?: any; xdrBase64?: string; error?: string };
  try {
    if (!editedJson.trim()) {
      roundTripResult = { ok: false, error: "Value cannot be empty." };
    } else {
      const parsed = JSON.parse(editedJson);
      roundTripResult = verifyRoundTrip(currentPreset?.type || "string", parsed);
    }
  } catch (err: any) {
    roundTripResult = { ok: false, error: `Invalid JSON syntax: ${err.message}` };
  }

  const handleApply = () => {
    if (onSelectVector && roundTripResult.ok) {
      // Wrap in array format for args or pass directly
      try {
        const parsed = JSON.parse(editedJson);
        const argsStr = JSON.stringify([parsed], null, 2);
        onSelectVector(argsStr);
        setApplied(true);
        setTimeout(() => setApplied(false), 1500);
      } catch {}
    }
  };

  return (
    <div
      data-testid="test-vectors-panel"
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
        <strong>Soroban Value Test Vectors</strong>
        <span style={{ color: "var(--muted, #8b949e)", fontSize: "11px" }}>Editable examples & round-trip tests</span>
      </div>

      {/* Category Tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "8px", flexWrap: "wrap" }}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => handleCategoryChange(cat)}
            style={{
              background: selectedCategory === cat ? "var(--accent, #58a6ff)" : "transparent",
              color: selectedCategory === cat ? "#fff" : "var(--text, #c9d1d9)",
              border: "1px solid var(--border, #30363d)",
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "11px",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Preset Dropdown */}
      <div style={{ marginBottom: "8px" }}>
        <select
          value={selectedPresetId}
          onChange={(e) => handlePresetChange(e.target.value)}
          style={{
            width: "100%",
            padding: "4px 8px",
            fontSize: "12px",
            backgroundColor: "var(--bg, #0d1117)",
            color: "var(--text, #c9d1d9)",
            border: "1px solid var(--border, #30363d)",
            borderRadius: "4px",
          }}
        >
          {currentCategoryPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.type})
            </option>
          ))}
        </select>
        {currentPreset && (
          <div style={{ color: "var(--muted, #8b949e)", fontSize: "11px", marginTop: "3px" }}>
            {currentPreset.description}
          </div>
        )}
      </div>

      {/* Editable JSON Input */}
      <div style={{ marginBottom: "8px" }}>
        <label style={{ display: "block", color: "var(--muted, #8b949e)", fontSize: "11px", marginBottom: "2px" }}>
          Edit Example Value (JSON):
        </label>
        <textarea
          value={editedJson}
          onChange={(e) => setEditedJson(e.target.value)}
          rows={3}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "11px",
            padding: "6px",
            backgroundColor: "var(--bg, #0d1117)",
            color: "var(--text, #c9d1d9)",
            border: `1px solid ${roundTripResult.ok ? "var(--border, #30363d)" : "#f48771"}`,
            borderRadius: "4px",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Live Round-Trip Verification Status */}
      <div style={{ marginBottom: "8px" }}>
        {roundTripResult.ok ? (
          <div
            data-testid="round-trip-success"
            style={{
              padding: "4px 8px",
              backgroundColor: "rgba(63, 185, 80, 0.1)",
              border: "1px solid var(--green, #3fb950)",
              borderRadius: "4px",
              color: "var(--green, #3fb950)",
              fontSize: "11px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>✓ Round-trip verified: JSON ↔ ScVal XDR</span>
            <span style={{ fontSize: "10px", color: "var(--muted, #8b949e)" }}>
              XDR: {roundTripResult.xdrBase64?.slice(0, 16)}…
            </span>
          </div>
        ) : (
          <div
            data-testid="round-trip-failure"
            style={{
              padding: "4px 8px",
              backgroundColor: "rgba(244, 135, 113, 0.1)",
              border: "1px solid #f48771",
              borderRadius: "4px",
              color: "#f48771",
              fontSize: "11px",
            }}
          >
            ✗ Round-trip failed: {roundTripResult.error}
          </div>
        )}
      </div>

      {/* Action: Apply as Args */}
      {onSelectVector && (
        <button
          onClick={handleApply}
          disabled={!roundTripResult.ok}
          style={{
            width: "100%",
            padding: "5px",
            fontSize: "11px",
            backgroundColor: roundTripResult.ok ? "var(--surface, #21262d)" : "transparent",
            color: roundTripResult.ok ? "var(--text, #c9d1d9)" : "var(--muted, #8b949e)",
            border: "1px solid var(--border, #30363d)",
            borderRadius: "4px",
            cursor: roundTripResult.ok ? "pointer" : "not-allowed",
          }}
        >
          {applied ? "✓ Applied to Simulation Args!" : "Insert into Simulation Args (JSON array)"}
        </button>
      )}
    </div>
  );
};

export default TestVectorsPanel;
