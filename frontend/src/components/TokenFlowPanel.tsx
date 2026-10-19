import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { DecodedEvent } from "../api";
import { classifyTokenFlows, type TokenTransfer } from "../utils/tokenFlow";
import { truncateAddress } from "../utils/strkey";

interface Props {
  address: string;
  events: DecodedEvent[];
}

const SECTIONS: { key: "incoming" | "outgoing" | "self"; label: string }[] = [
  { key: "incoming", label: "Incoming" },
  { key: "outgoing", label: "Outgoing" },
  { key: "self", label: "Self-transfers" },
];

function TransferRow({ transfer }: { transfer: TokenTransfer }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ padding: "6px 8px", fontSize: 12 }}>
        <Link to={`/event/${transfer.seq}`} title={transfer.eventId}>
          #{transfer.seq}
        </Link>
      </td>
      <td style={{ padding: "6px 8px", fontSize: 12 }} title={transfer.from}>{truncateAddress(transfer.from)}</td>
      <td style={{ padding: "6px 8px", fontSize: 12 }} title={transfer.to}>{truncateAddress(transfer.to)}</td>
      <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{transfer.amount}</td>
      <td style={{ padding: "6px 8px", fontSize: 12 }}>
        {transfer.txHash ? <Link to={`/tx/${transfer.txHash}`}>{truncateAddress(transfer.txHash)}</Link> : "—"}
      </td>
    </tr>
  );
}

/**
 * Token-flow view for a wallet (#1042): decoded SEP-41 transfers grouped into
 * incoming, outgoing and self-transfers, each row linking to its source event.
 */
export default function TokenFlowPanel({ address, events }: Props) {
  const flows = useMemo(() => classifyTokenFlows(events, address), [events, address]);
  const total = flows.incoming.length + flows.outgoing.length + flows.self.length;

  return (
    <section aria-labelledby="token-flow-heading">
      <h3 id="token-flow-heading" style={{ marginBottom: 4 }}>Token Flow</h3>
      {total === 0 ? (
        <p style={{ color: "var(--muted)" }}>No decoded token transfers involve this wallet in the loaded history.</p>
      ) : (
        SECTIONS.map(({ key, label }) => {
          const rows = flows[key];
          return (
            <div key={key} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                {label} ({rows.length})
              </div>
              {rows.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>None</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                        <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500 }}>Event</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500 }}>From</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500 }}>To</th>
                        <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 500 }}>Amount</th>
                        <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500 }}>Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <TransferRow key={t.eventId} transfer={t} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
