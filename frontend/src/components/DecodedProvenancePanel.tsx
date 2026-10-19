/**
 * DecodedProvenancePanel (#1031)
 * Lists each decoded value on an event with the decoder rule and raw source
 * field that produced it, plus the ABI version when the event records one.
 */
import type { DecodedEvent } from "../api";
import { buildDecodedProvenance } from "../utils/decodedProvenance";

export default function DecodedProvenancePanel({ event }: { event: DecodedEvent }) {
  const { abiVersion, rows } = buildDecodedProvenance(event);

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <h4 style={{ fontSize: 13, margin: 0 }}>Decoded value provenance</h4>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        ABI version:{" "}
        <strong style={{ color: "var(--text)" }}>
          {abiVersion !== null ? `v${abiVersion}` : "not recorded on this event"}
        </strong>
      </div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>No decoded values to explain.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th style={{ padding: 6 }}>Field</th>
                <th style={{ padding: 6 }}>Value</th>
                <th style={{ padding: 6 }}>Decoder rule</th>
                <th style={{ padding: 6 }}>Source field</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.field}-${i}`}>
                  <td style={{ padding: 6 }}>{row.field}</td>
                  <td style={{ padding: 6, wordBreak: "break-word" }}>{row.value}</td>
                  <td style={{ padding: 6 }}>{row.rule}</td>
                  <td style={{ padding: 6, fontFamily: "monospace", wordBreak: "break-all" }}>{row.sourceField}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
