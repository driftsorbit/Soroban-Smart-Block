/**
 * XdrDecodedSplitView (#1032)
 * Shows raw XDR beside the decoded fields. Hovering or focusing either side
 * highlights the counterpart it was decoded from, and each decoded field path
 * can be copied.
 */
import { useState } from "react";
import type { DecodedEvent } from "../api";
import { decodedView, flattenFieldPaths, linkDecodedToRaw, rawBlocks } from "../utils/xdrFieldPaths";

const HIGHLIGHT = "rgba(59,130,246,0.18)";

export default function XdrDecodedSplitView({ event }: { event: DecodedEvent }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  const blocks = rawBlocks(event);
  const fields = flattenFieldPaths(decodedView(event));
  const links = linkDecodedToRaw(event);

  if (blocks.length === 0 && fields.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 13 }}>No raw XDR or decoded fields to compare.</p>;
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopyFailed(false);
      setCopiedPath(path);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <h4 style={{ fontSize: 13, margin: 0 }}>Raw XDR and decoded view</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <section aria-label="Raw XDR" style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <strong style={{ fontSize: 12, color: "var(--muted)" }}>Raw XDR</strong>
          {blocks.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>No raw XDR recorded.</p>}
          {blocks.map((block) => (
            <div
              key={block.key}
              tabIndex={0}
              onMouseEnter={() => setActiveKey(block.key)}
              onMouseLeave={() => setActiveKey(null)}
              onFocus={() => setActiveKey(block.key)}
              onBlur={() => setActiveKey(null)}
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                padding: 6,
                borderRadius: 4,
                background: activeKey === block.key ? HIGHLIGHT : "transparent",
                wordBreak: "break-all",
              }}
            >
              <div style={{ color: "var(--muted)", marginBottom: 2 }}>{block.key}</div>
              {block.value}
            </div>
          ))}
        </section>

        <section aria-label="Decoded fields" style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <strong style={{ fontSize: 12, color: "var(--muted)" }}>Decoded fields</strong>
          {fields.map((field) => {
            const source = links[field.path];
            return (
              <div
                key={field.path}
                tabIndex={source ? 0 : -1}
                onMouseEnter={() => source && setActiveKey(source)}
                onMouseLeave={() => setActiveKey(null)}
                onFocus={() => source && setActiveKey(source)}
                onBlur={() => setActiveKey(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 6,
                  borderRadius: 4,
                  fontSize: 12,
                  background: source && activeKey === source ? HIGHLIGHT : "transparent",
                  minWidth: 0,
                }}
              >
                <code style={{ color: "var(--muted)", wordBreak: "break-all" }}>{field.path}</code>
                <span style={{ flex: 1, wordBreak: "break-word" }}>{field.value}</span>
                <button type="button" onClick={() => copyPath(field.path)} aria-label={`Copy path ${field.path}`}>
                  {copiedPath === field.path ? "Copied" : "Copy path"}
                </button>
              </div>
            );
          })}
          {copyFailed && <p role="alert" style={{ color: "#ef4444", fontSize: 12, margin: 0 }}>Could not copy to clipboard.</p>}
        </section>
      </div>
    </div>
  );
}
