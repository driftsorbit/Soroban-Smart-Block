import { useState, type FormEvent } from "react";
import {
  readLabels,
  removeAddressLabel,
  setAddressLabel,
  writeLabels,
  type AddressLabels,
} from "../utils/addressLabels";

interface Props {
  address: string;
}

const buttonStyle = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
};

/**
 * Private, browser-only label for a wallet (#1043). Labels are stored locally
 * and never uploaded; erasing removes the label from this browser only.
 */
export default function AddressLabelEditor({ address }: Props) {
  const [labels, setLabels] = useState<AddressLabels>(() => readLabels());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const current = labels[address];

  const persist = (next: AddressLabels) => {
    setLabels(next);
    setSaveFailed(!writeLabels(next));
  };

  const startEditing = () => {
    setDraft(current ?? "");
    setError(null);
    setEditing(true);
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const result = setAddressLabel(labels, address, draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    persist(result.labels);
    setEditing(false);
  };

  const erase = () => {
    persist(removeAddressLabel(labels, address));
    setEditing(false);
  };

  if (editing) {
    return (
      <form onSubmit={save} aria-label="Edit address label" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="address-label-input" style={{ fontSize: 12, color: "var(--muted)" }}>
          Label
        </label>
        <input
          id="address-label-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "address-label-error" : undefined}
          style={{ ...buttonStyle, minWidth: 180, cursor: "text" }}
        />
        <button type="submit" style={buttonStyle}>Save</button>
        <button type="button" style={buttonStyle} onClick={() => setEditing(false)}>Cancel</button>
        {error && (
          <span id="address-label-error" role="alert" style={{ fontSize: 12, color: "#f85149" }}>
            {error}
          </span>
        )}
      </form>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
      {current ? (
        <span>
          <span style={{ color: "var(--muted)" }}>Private label:</span> <strong>{current}</strong>
        </span>
      ) : (
        <span style={{ color: "var(--muted)" }}>No private label</span>
      )}
      <button type="button" style={buttonStyle} onClick={startEditing}>
        {current ? "Edit label" : "Add label"}
      </button>
      {current && (
        <button type="button" style={buttonStyle} onClick={erase}>
          Erase label
        </button>
      )}
      {saveFailed && (
        <span role="alert" style={{ fontSize: 12, color: "#f85149" }}>
          Could not save label in this browser.
        </span>
      )}
    </div>
  );
}
