/**
 * AbiUploadZone.tsx
 *
 * Drag-and-drop (and click-to-browse) zone for uploading a local ABI file.
 * Accepts .json files only.  Parses the file in the browser and calls
 * onLoad with the raw parsed JSON — no network request is made.
 *
 * Displays:
 *   - Drop zone with visual drag-over feedback
 *   - Loaded ABI summary (name, function count, filename, timestamp)
 *   - Inline validation error messages
 *   - A "Clear" button to remove the local ABI
 */

import { useRef, useState, useCallback, type DragEvent, type ChangeEvent } from "react";
import type { LocalAbi } from "../hooks/useLocalAbi";

interface Props {
  /** Called with the raw parsed JSON when a valid file is dropped/selected */
  onLoad: (raw: unknown, fileName: string) => void;
  /** Called when the user clears the loaded ABI */
  onClear: () => void;
  /** Currently loaded ABI (null = none loaded) */
  localAbi: LocalAbi | null;
  /** Parse/validation error from the hook */
  parseError: string | null;
}

export default function AbiUploadZone({ onLoad, onClear, localAbi, parseError }: Props) {
  const [dragging, setDragging] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── File reading ────────────────────────────────────────────────────────────

  const readFile = useCallback((file: File) => {
    setReadError(null);

    if (!file.name.endsWith(".json")) {
      setReadError("Only .json files are accepted.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== "string") throw new Error("Could not read file.");
        const parsed = JSON.parse(text);
        onLoad(parsed, file.name);
      } catch (err: unknown) {
        setReadError(
          err instanceof SyntaxError
            ? "Invalid JSON — check the file for syntax errors."
            : err instanceof Error
              ? err.message
              : "Unknown error reading file.",
        );
      }
    };
    reader.onerror = () => setReadError("File read failed.");
    reader.readAsText(file);
  }, [onLoad]);

  // ── Drag handlers ───────────────────────────────────────────────────────────

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) readFile(file);
      // Reset so the same file can be re-uploaded
      e.target.value = "";
    },
    [readFile],
  );

  const error = readError ?? parseError;

  // ── Loaded state ────────────────────────────────────────────────────────────

  if (localAbi) {
    return (
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--green)",
          borderRadius: 8,
          padding: "12px 16px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Icon + title row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📄</span>
            <span style={{ fontWeight: 600, color: "var(--green)", fontSize: 13 }}>Local ABI loaded</span>
            <span
              style={{
                fontSize: 11,
                background: "#1a3a22",
                color: "var(--green)",
                borderRadius: 10,
                padding: "1px 8px",
                fontWeight: 600,
              }}
            >
              session only
            </span>
          </div>

          {/* File info */}
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <span>
              <span style={{ color: "var(--text)" }}>File:</span> {localAbi.fileName}
            </span>
            {localAbi.name && (
              <span>
                <span style={{ color: "var(--text)" }}>Name:</span> {localAbi.name}
              </span>
            )}
            <span>
              <span style={{ color: "var(--text)" }}>Functions:</span> {localAbi.functions.length}
            </span>
            {localAbi.types && localAbi.types.length > 0 && (
              <span>
                <span style={{ color: "var(--text)" }}>Types:</span> {localAbi.types.length}
              </span>
            )}
            <span>
              <span style={{ color: "var(--text)" }}>Loaded:</span> {new Date(localAbi.loadedAt).toLocaleTimeString()}
            </span>
          </div>

          {/* Function list */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {localAbi.functions.map((f) => (
              <span key={f.name} className="badge" style={{ fontSize: 11 }}>
                {f.name}
              </span>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => inputRef.current?.click()}
            style={{
              background: "var(--border)",
              color: "var(--text)",
              fontSize: 12,
              padding: "4px 10px",
            }}
            title="Replace with a different file"
          >
            Replace
          </button>
          <button
            onClick={onClear}
            style={{
              background: "#3a0d0d",
              color: "#f85149",
              fontSize: 12,
              padding: "4px 10px",
            }}
            title="Remove local ABI"
          >
            Clear
          </button>
        </div>

        {/* Hidden file input for Replace */}
        <input ref={inputRef} type="file" accept=".json" style={{ display: "none" }} onChange={onInputChange} />
      </div>
    );
  }

  // ── Empty / drop zone state ─────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop an ABI JSON file here or click to browse"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8,
          padding: "20px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? "rgba(88,166,255,0.06)" : "transparent",
          transition: "border-color 0.15s, background 0.15s",
          userSelect: "none",
        }}
      >
        <div style={{ fontSize: 24, marginBottom: 8 }}>📂</div>
        <p style={{ color: "var(--text)", fontSize: 13, marginBottom: 4 }}>
          Drop a contract ABI <code style={{ color: "var(--accent)" }}>.json</code> file here
        </p>
        <p style={{ color: "var(--muted)", fontSize: 12 }}>
          or click to browse — stored in session memory only, never sent to the server
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div
          role="alert"
          style={{
            background: "rgba(248,81,73,0.1)",
            border: "1px solid #f85149",
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 12,
            color: "#f85149",
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <span style={{ flexShrink: 0 }}>⚠</span>
          <span>{error}</span>
        </div>
      )}

      {/* Accepted formats hint */}
      <details style={{ fontSize: 11, color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer" }}>Accepted file formats</summary>
        <div
          style={{
            marginTop: 8,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div>
            <strong style={{ color: "var(--text)" }}>Registry format</strong>
            <pre
              style={{
                margin: "4px 0 0",
                fontSize: 11,
                color: "var(--muted)",
                overflowX: "auto",
              }}
            >{`{
  "contractId": "C...",
  "name": "My Contract",
  "functions": [
    { "name": "transfer", "template": "{from} → {to}: {amount}" }
  ]
}`}</pre>
          </div>
          <div>
            <strong style={{ color: "var(--text)" }}>Full-spec format</strong>
            <pre
              style={{
                margin: "4px 0 0",
                fontSize: 11,
                color: "var(--muted)",
                overflowX: "auto",
              }}
            >{`{
  "functions": [
    { "name": "transfer", "inputs": [{"name":"from","type":"Address"}] }
  ],
  "types": [{ "kind": "struct", "name": "Config", "fields": [...] }]
}`}</pre>
          </div>
          <div>
            <strong style={{ color: "var(--text)" }}>Flat array</strong>
            <pre
              style={{
                margin: "4px 0 0",
                fontSize: 11,
                color: "var(--muted)",
                overflowX: "auto",
              }}
            >{`[{ "name": "transfer", "params": [...] }]`}</pre>
          </div>
        </div>
      </details>

      <input
        ref={inputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={onInputChange}
        aria-hidden="true"
      />
    </div>
  );
}
