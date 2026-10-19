import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { HorizonBalance } from "../api";
import { getUsdRate } from "../utils/exchangeRate";
import {
  appendSnapshot,
  buildSnapshot,
  readSnapshots,
  writeSnapshots,
  type ValueSnapshot,
} from "../utils/valueSnapshots";

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

function describePrice(snap: ValueSnapshot): string {
  if (snap.price.status === "unavailable") return `Unavailable — ${snap.price.reason}`;
  return `$${snap.usd_value?.toFixed(2)} at $${snap.price.usd_per_xlm} per XLM (rate fetched ${new Date(snap.price.fetched_at).toLocaleString()})`;
}

/**
 * Opt-in XLM value history (#1044). Nothing is recorded until the user clicks
 * "Record snapshot"; history stays in this browser and can be cleared.
 */
export default function PortfolioSnapshots({ address }: Props) {
  const [history, setHistory] = useState<ValueSnapshot[]>(() => readSnapshots(address, storage()));
  const [recording, setRecording] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const { data: balances } = useQuery({
    queryKey: ["walletBalances", address],
    queryFn: () => api.wallet(address).then((r) => r.horizon_account?.balances ?? []),
    enabled: !!address,
    retry: false,
  });

  const record = async () => {
    if (!balances) return;
    setRecording(true);
    const observedAt = new Date();
    const usdPerXlm = await getUsdRate("XLM");
    const fetchedAt = new Date();
    const snap = buildSnapshot({ balances: balances as HorizonBalance[], usdPerXlm, observedAt, fetchedAt });
    const next = appendSnapshot(history, snap);
    setHistory(next);
    setSaveFailed(!writeSnapshots(address, next, storage()));
    setRecording(false);
  };

  const clear = () => {
    setHistory([]);
    setSaveFailed(!writeSnapshots(address, [], storage()));
  };

  return (
    <section aria-labelledby="value-history-heading">
      <h3 id="value-history-heading" style={{ marginBottom: 4 }}>Value History</h3>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
        Off until you record a snapshot. Stored only in this browser. Only XLM is valued; other assets are counted but not priced.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={buttonStyle} onClick={record} disabled={!balances || recording}>
          {recording ? "Recording…" : "Record snapshot"}
        </button>
        {history.length > 0 && (
          <button type="button" style={buttonStyle} onClick={clear}>
            Clear history
          </button>
        )}
      </div>
      {saveFailed && (
        <p role="alert" style={{ color: "#f85149", fontSize: 13 }}>Could not save snapshot in this browser.</p>
      )}
      {history.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>No snapshots recorded yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
          {[...history].reverse().map((snap) => (
            <li key={snap.observed_at} style={{ borderBottom: "1px solid var(--border)", padding: "6px 0", fontSize: 13 }}>
              <div>{new Date(snap.observed_at).toLocaleString()} · source: {snap.source}</div>
              <div>
                {snap.xlm_balance} XLM · {snap.usd_value === null ? "USD value unavailable" : `$${snap.usd_value.toFixed(2)} USD`}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>{describePrice(snap)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
