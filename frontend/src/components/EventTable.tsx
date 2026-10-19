import { useMemo, useRef, useLayoutEffect, memo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api";
import type { ContractMeta, DecodedEvent } from "../api";
import { useVirtualList } from "../hooks/useVirtualList";
import EventColumnSettings from "./EventColumnSettings";
import {
  EVENT_COLUMN_LABELS,
  loadEventColumns,
  saveEventColumns,
  type EventColumnId,
} from "../utils/eventColumns";
import FiatValue from "./FiatValue";
import AssetLogo from "./AssetLogo";
import CopyableAddress from "./CopyableAddress";
import { getGasAlert } from "./GasLimitAlert";
import ProtocolBadge from "./ProtocolBadge";
import { addressRoute, truncateAddress, isAccountAddress, isContractAddress, isMuxedAddress } from "../utils/strkey";
import { readFeedScroll, saveFeedScroll } from "../utils/feedViewState";
import { feedRowHeight, type FeedDensity } from "../utils/feedDensity";
import { classifyDecodeState, DECODE_STATE_LABELS } from "../utils/decodeState";
import { txEventOrder, type TxEventOrder } from "../utils/eventOrdering";

/** Stellar strkey address pattern: G.../C.../M... (56+ chars, base32 alphabet) */
const ADDRESS_RE = /\b([GCM][A-Z2-7]{55,})\b/g;

/**
 * Render a description string with any Stellar addresses (G..., C..., M...)
 * replaced by clickable <Link> elements with copy-to-clipboard functionality.
 * M... muxed addresses link to the base G... wallet page via addressRoute().
 */
const LinkedDescription = memo(function LinkedDescription({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  ADDRESS_RE.lastIndex = 0;
  while ((match = ADDRESS_RE.exec(text)) !== null) {
    const addr = match[1];
    if (!isAccountAddress(addr) && !isContractAddress(addr) && !isMuxedAddress(addr)) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    const route = addressRoute(addr);
    if (route) {
      parts.push(
        <Link key={match.index} to={route} title={addr}>
          <CopyableAddress fullValue={addr} displayValue={truncateAddress(addr)} />
        </Link>,
      );
    } else {
      parts.push(
        <CopyableAddress key={match.index} fullValue={addr} displayValue={truncateAddress(addr)} />,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
});

/** Parse a multi-hop swap path from a description or swap_path field. */
function parseSwapPath(description: string): string[] | null {
  const arrowParts = description.split(/\s*→\s*/);
  if (arrowParts.length >= 2) {
    const hops = arrowParts.map((p) => p.match(/([\d,.]+)\s+([A-Z]{2,10})/)?.[0]).filter(Boolean) as string[];
    if (hops.length >= 2) return hops;
  }
  const m = description.match(/([\d,.]+)\s+([A-Z]{2,10}).*?(?:for|to)\s+([\d,.]+)\s+([A-Z]{2,10})/i);
  if (m) return [`${m[1]} ${m[2]}`, `${m[3]} ${m[4]}`];
  return null;
}

/** Parse amount and symbol from a transfer description like "Address GA… transferred 50.00 PYUSD to …" */
function parseTransfer(description: string): { amount: number; symbol: string } | null {
  const m = description.match(/transferred\s+([\d,.]+)\s+([A-Z]{2,10})/i);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(amount) ? null : { amount, symbol: m[2].toUpperCase() };
}

/** Extract the destination asset code/issuer from a classic payment's raw_data JSON, if present. */
function parseClassicAsset(ev: DecodedEvent): { code: string; issuer: string | null } | null {
  if (ev.type !== "classic" || !ev.raw_data) return null;
  try {
    const op = JSON.parse(ev.raw_data);
    if (!op.asset_code) return null;
    return { code: op.asset_code, issuer: op.asset_issuer ?? null };
  } catch {
    return null;
  }
}

interface Props {
  events: DecodedEvent[];
  onReachEnd?: () => void;
  /** Filter query string used to remember and restore the scroll offset (#1034). */
  scrollKey?: string;
  /** Row density (#1035). Defaults to comfortable. */
  density?: FeedDensity;
}

const FunctionBadge = memo(function FunctionBadge({ fn, isClassic }: { fn: string; isClassic?: boolean }) {
  if (isClassic) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span className="badge classic">Classic</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{fn}</span>
      </span>
    );
  }
  if (fn === "wrap_native") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span className="badge wrap">Wrap Native Asset</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Classic XLM → Soroban</span>
      </span>
    );
  }
  if (fn === "unwrap_native") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span className="badge unwrap">Unwrap Native Asset</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Soroban → Classic XLM</span>
      </span>
    );
  }
  return <span className="badge">{fn}</span>;
});

/** Badge for SAC implicit side-effects (auto-created account or trustline). */
const SacSideEffectBadge = memo(function SacSideEffectBadge({ kind }: { kind: NonNullable<DecodedEvent["sac_side_effect"]> }) {
  const isAccountCreated = kind === "account_created";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        background: isAccountCreated ? "rgba(16,185,129,0.12)" : "rgba(59,130,246,0.12)",
        border: `1px solid ${isAccountCreated ? "#10b981" : "#3b82f6"}`,
        borderRadius: 4,
        fontSize: 11,
        color: isAccountCreated ? "#34d399" : "#60a5fa",
        whiteSpace: "nowrap",
        marginRight: 6,
        verticalAlign: "middle",
      }}
      title={
        isAccountCreated
          ? "SAC implicitly created a new Stellar account entry for this recipient"
          : "SAC implicitly opened a trustline for this asset on the recipient account"
      }
    >
      {isAccountCreated ? "⬡ SAC Auto-Created Account Entry" : "⬡ SAC Native Trustline Open"}
    </span>
  );
});

/** Inline badge for Protocol 26 TTL extension events. */
const TTLExtensionBadge = memo(function TTLExtensionBadge({ ext }: { ext: NonNullable<DecodedEvent["ttl_extension"]> }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        background: "rgba(99,102,241,0.12)",
        border: "1px solid #6366f1",
        borderRadius: 4,
        fontSize: 11,
        color: "#818cf8",
        whiteSpace: "nowrap",
        marginRight: 6,
        verticalAlign: "middle",
      }}
      title="Protocol 26 TTL rent extension"
    >
      ⏱ TTL Extension
      {ext.min_extension != null && (
        <span style={{ color: "var(--muted)" }}>Requested: +{ext.min_extension} Ledgers</span>
      )}
      {ext.max_extension != null && <span style={{ color: "var(--muted)" }}>Clamp: {ext.max_extension}</span>}
      {ext.extend_to != null && <span style={{ color: "var(--muted)" }}>→ {ext.extend_to}</span>}
    </span>
  );
});

/** Inline badge for factory deployment events. */
const FactoryDeploymentBadge = memo(function FactoryDeploymentBadge({ deployment }: { deployment: NonNullable<DecodedEvent["factory_deployment"]> }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        background: "rgba(210,168,255,0.12)",
        border: "1px solid #d2a8ff",
        borderRadius: 4,
        fontSize: 11,
        color: "#d2a8ff",
        whiteSpace: "nowrap",
        marginRight: 6,
        verticalAlign: "middle",
        fontWeight: 600,
      }}
      title={`Factory deployment: ${deployment.contracts.length} contracts deployed in single transaction`}
    >
      ⬢ FACTORY DEPLOYMENT ({deployment.contracts.length} contracts)
    </span>
  );
});

/** Contract name (linked) + protocol badge — shown for events from known contracts (issue #556). */
const ContractCell = memo(function ContractCell({ contractId, meta }: { contractId: string; meta?: ContractMeta }) {
  if (!contractId) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <Link to={`/contract/${contractId}`}>
        <CopyableAddress fullValue={contractId} displayValue={meta?.name || truncateAddress(contractId)} />
      </Link>
      <ProtocolBadge type={meta?.protocol_type} />
    </span>
  );
});

/** Render a single event row (extracted so it can be reused in both modes). */
const EventRow = memo(function EventRow({
  ev,
  contractMeta,
  txOrder,
}: {
  ev: DecodedEvent;
  contractMeta?: ContractMeta;
  txOrder?: TxEventOrder;
}) {
  return (
    <>
      <td style={td}>
        <Link to={`/event/${ev.seq}`}>#{ev.seq}</Link>
        {txOrder && (
          <span
            data-testid="tx-event-order"
            title={`Event ${txOrder.position} of ${txOrder.total} in this transaction, ordered by indexer sequence (seq)`}
            style={{ display: "block", fontSize: 11, color: "var(--muted)" }}
          >
            tx {txOrder.position}/{txOrder.total}
          </span>
        )}
      </td>
      <td style={td}>{ev.ledger.toLocaleString()}</td>
      <td style={td}>
        <ContractCell contractId={ev.contract_id} meta={contractMeta} />
      </td>
      <td style={td}>
        <FunctionBadge fn={ev.function} />
      </td>
      <td
        style={{
          ...td,
          maxWidth: 480,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {(() => {
          // Distinguish why decoding fell short (#1036) instead of one generic badge.
          const state = classifyDecodeState(ev);
          if (state === "decoded") return null;
          const { label, title } = DECODE_STATE_LABELS[state];
          const warnings = ev.decode_warnings?.join(", ");
          return (
            <span
              className="badge"
              data-decode-state={state}
              title={warnings ? `${title}: ${warnings}` : title}
              style={{ marginRight: 6, color: "var(--yellow, #f59e0b)" }}
            >
              {label}
            </span>
          );
        })()}
        {ev.is_clawback && (
          <span className="badge clawback" style={{ marginRight: 6 }} title="Mandatory authority intervention">
            ⚠ COMPLIANCE: CLAWBACK
          </span>
        )}
        {getGasAlert(ev) && (
          <span
            style={{
              display: "inline-block",
              marginRight: 6,
              padding: "1px 6px",
              background: "rgba(245,158,11,0.15)",
              border: "1px solid #f59e0b",
              borderRadius: 4,
              fontSize: 11,
              color: "#f59e0b",
              verticalAlign: "middle",
            }}
            title="High gas usage — >80% of network limit"
          >
            ⚠ High Gas
          </span>
        )}
        {ev.ttl_extension && <TTLExtensionBadge ext={ev.ttl_extension} />}
        {ev.factory_deployment && <FactoryDeploymentBadge deployment={ev.factory_deployment} />}
        {ev.sac_side_effect && <SacSideEffectBadge kind={ev.sac_side_effect} />}
        <LinkedDescription text={ev.description} />
        {ev.function === "transfer" &&
          (() => {
            const t = parseTransfer(ev.description);
            if (!t) return null;
            const asset = parseClassicAsset(ev);
            return (
              <>
                {asset && <AssetLogo code={asset.code} issuer={asset.issuer} />}
                <FiatValue amount={t.amount} symbol={t.symbol} />
              </>
            );
          })()}
        {ev.function === "swap" &&
          (() => {
            const path = ev.swap_path ?? parseSwapPath(ev.description);
            return path ? (
              <span
                style={{
                  marginLeft: 6,
                  color: "var(--accent)",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {path.join(" → ")}
              </span>
            ) : null;
          })()}
    </td>
  );
});

/** One event row. Cells render in the configured column order (#1039). */
const EventRow = memo(function EventRow({
  ev,
  contractMeta,
  columns,
}: {
  ev: DecodedEvent;
  contractMeta?: ContractMeta;
  columns: EventColumnId[];
}) {
  const cells: Record<EventColumnId, React.ReactNode> = {
    seq: (
      <td style={td}>
        <Link to={`/event/${ev.seq}`}>#{ev.seq}</Link>
      </td>
    ),
    ledger: <td style={td}>{ev.ledger.toLocaleString()}</td>,
    contract: (
      <td style={td}>
        <ContractCell contractId={ev.contract_id} meta={contractMeta} />
      </td>
    ),
    function: (
      <td style={td}>
        <FunctionBadge fn={ev.function} />
      </td>
    ),
    description: <DescriptionCell ev={ev} />,
  };
  return (
    <>
      {columns.map((id) => (
        <Fragment key={id}>{cells[id]}</Fragment>
      ))}
    </>
  );
});

export default function EventTable({ events, onReachEnd, scrollKey, density = "comfortable" }: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rowHeight = feedRowHeight(density);
  const { totalHeight, visibleItems } = useVirtualList(events, scrollContainerRef, rowHeight);
  const navigate = useNavigate();
  const restoredRef = useRef(false);
  const hasRows = events.length > 0;

  // Restore the saved offset once the rows exist, so the spacer is tall enough
  // to scroll to it (#1034). Runs at most once per mount.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !scrollKey || !hasRows || restoredRef.current) return;
    restoredRef.current = true;
    el.scrollTop = readFeedScroll(scrollKey);
  }, [scrollKey, hasRows]);

  // Batch-fetch contract metadata for the badge shown next to each contract
  // name (issue #556) — one request per unique contract on the page, cached
  // by contract ID so repeat visits/pages don't refetch.
  const contractIds = useMemo(
    () => Array.from(new Set(events.map((e) => e.contract_id).filter(Boolean))),
    [events],
  );
  const contractQueries = useQueries({
    queries: contractIds.map((id) => ({
      queryKey: ["contract", id],
      queryFn: () => api.contract(id),
      staleTime: 5 * 60 * 1000,
      retry: false,
    })),
  });
  // Position of each event within its transaction (#1037), over the loaded events.
  const txOrderBySeq = useMemo(() => txEventOrder(events), [events]);
  const contractMetaById = useMemo(() => {
    const map = new Map<string, ContractMeta>();
    contractIds.forEach((id, i) => {
      const data = contractQueries[i]?.data;
      if (data) map.set(id, data);
    });
    return map;
  }, [contractIds, contractQueries]);

  if (!events.length)
    return (
      <p data-testid="empty-state" style={{ color: "var(--muted)" }}>
        No events yet.
      </p>
    );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }} data-density={density}>
        <thead>
          <tr
            style={{
              borderBottom: "1px solid var(--border)",
              color: "var(--muted)",
            }}
          >
            {columns.map((id) => (
              <th key={id} style={th}>
                {EVENT_COLUMN_LABELS[id]}
              </th>
            ))}
          </tr>
        </thead>
      </table>

      {/* Virtualized scroll area — rows are position:absolute inside here */}
      <div
        ref={scrollContainerRef}
        data-testid="virtual-scroll-container"
        style={{
          overflowY: "auto",
          maxHeight: 600,
          position: "relative",
        }}
        onScroll={(event) => {
          const target = event.currentTarget;
          if (scrollKey) saveFeedScroll(scrollKey, target.scrollTop);
          if (onReachEnd && target.scrollTop + target.clientHeight >= target.scrollHeight - rowHeight * 4) {
            onReachEnd();
          }
        }}
      >
        {/* Spacer div creates the full scrollable height */}
        <div style={{ height: totalHeight, position: "relative" }}>
          {visibleItems.map(({ item, style }) => (
            <div
              key={item.seq}
              style={{ ...style, cursor: 'pointer', outline: 'none' }}
              tabIndex={0}
              role="row"
              aria-label={`Event #${item.seq}`}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/event/${item.seq}`); }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  tableLayout: "fixed",
                }}
              >
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--border)", fontSize: density === "compact" ? 12 : undefined }}>
                    <EventRow
                      ev={item}
                      contractMeta={contractMetaById.get(item.contract_id)}
                      txOrder={txOrderBySeq.get(item.seq)}
                    />
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontWeight: 500,
};
const td: React.CSSProperties = { padding: "10px 12px" };
