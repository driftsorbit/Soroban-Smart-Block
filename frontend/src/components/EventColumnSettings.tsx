import { useState } from "react";
import {
  DEFAULT_EVENT_COLUMNS,
  EVENT_COLUMN_IDS,
  EVENT_COLUMN_LABELS,
  moveEventColumn,
  toggleEventColumn,
  type EventColumnId,
} from "../utils/eventColumns";

interface Props {
  columns: EventColumnId[];
  onChange: (next: EventColumnId[]) => void;
}

/**
 * Column chooser for the event table (#1039). Collapsed by default. When open
 * it lists every column with a visibility checkbox, move buttons for the
 * visible ones, and a reset button.
 */
export default function EventColumnSettings({ columns, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isDefault = columns.join(",") === DEFAULT_EVENT_COLUMNS.join(",");
  const order = [...columns, ...EVENT_COLUMN_IDS.filter((id) => !columns.includes(id))];

  return (
    <div style={{ marginBottom: 8, fontSize: 13 }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        style={{ color: "var(--muted)", fontSize: 13 }}
      >
        Columns {expanded ? "▴" : "▾"}
      </button>

      {expanded && (
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 12, marginTop: 8 }}>
          <legend style={{ color: "var(--muted)" }}>Visible columns and order</legend>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {order.map((id) => {
              const visible = columns.includes(id);
              const position = columns.indexOf(id);
              return (
                <li key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 140 }}>
                    <input
                      type="checkbox"
                      checked={visible}
                      disabled={visible && columns.length === 1}
                      onChange={() => onChange(toggleEventColumn(columns, id))}
                    />
                    {EVENT_COLUMN_LABELS[id]}
                  </label>
                  {visible && (
                    <>
                      <button
                        type="button"
                        aria-label={`Move ${EVENT_COLUMN_LABELS[id]} earlier`}
                        disabled={position === 0}
                        onClick={() => onChange(moveEventColumn(columns, id, -1))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${EVENT_COLUMN_LABELS[id]} later`}
                        disabled={position === columns.length - 1}
                        onClick={() => onChange(moveEventColumn(columns, id, 1))}
                      >
                        ↓
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => onChange([...DEFAULT_EVENT_COLUMNS])}
            disabled={isDefault}
            style={{ marginTop: 10 }}
          >
            Reset to defaults
          </button>
        </fieldset>
      )}
    </div>
  );
}
