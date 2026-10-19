import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import ResourceCosts from "../components/ResourceCosts";
import StorageTierBreakdown from "../components/StorageTierBreakdown";
import GasLimitAlert from "../components/GasLimitAlert";
import FeeSponsorBanner from "../components/FeeSponsorBanner";
import RestoreFootprintPanel from "../components/RestoreFootprintPanel";
import HeuristicParams from "../components/HeuristicParams";
import ZkCostDelta from "../components/ZkCostDelta";
import FactoryDeploymentTree from "../components/FactoryDeploymentTree";
import { useTranslation } from "../i18n";
import ProvenancePanel from "../components/ProvenancePanel";
import DecodedProvenancePanel from "../components/DecodedProvenancePanel";
import XdrDecodedSplitView from "../components/XdrDecodedSplitView";

export default function EventPage() {
  const { t } = useTranslation();
  const { seq = "0" } = useParams();

  const { data: ev, isLoading } = useQuery({
    queryKey: ["event", seq],
    queryFn: () => api.event(seq),
  });

  // Summary of everything the event's transaction did (#897).
  const { data: narrative } = useQuery({
    queryKey: ["tx-narrative", ev?.tx_hash],
    queryFn: () => api.txNarrative(ev!.tx_hash!),
    enabled: Boolean(ev?.tx_hash),
    retry: false,
  });

  if (isLoading) return <p style={{ color: "var(--muted)" }}>{t("app.loading")}</p>;
  if (!ev) return (
    <div style={{ textAlign: "center", marginTop: "2rem" }}>
      <p>{t("event.notFound")}</p>
      <Link to="/" style={{ color: "var(--primary)", textDecoration: "underline" }}>
        {t("event.back")}
      </Link>
    </div>
  );

  const isReorg = Boolean((ev as any).is_reorg || (ev as any).superseded);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Dedicated print-only header */}
      <div className="print-only print-header">
        <div>
          <div className="print-header-brand">Soroban Smart Block Explorer</div>
          <div style={{ fontSize: "9pt", color: "#4b5563" }}>Certified Event Compliance Audit</div>
        </div>
        <div className="print-header-meta">
          <div>Event #{ev.seq}</div>
          <div>Ledger #{ev.ledger.toLocaleString()}</div>
        </div>
      </div>

      {/* Screen action bar */}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <h2 style={{ margin: 0 }}>Event #{ev.seq}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              padding: "6px 14px",
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
            title="Print or save as PDF via browser print dialog"
          >
            🖨 Print View
          </button>
          <a
            href={api.eventReportUrl(ev.seq)}
            target="_blank"
            rel="noopener noreferrer"
            download={`soroban-event-${ev.seq}-audit.pdf`}
            style={{
              padding: "6px 14px",
              background: "var(--accent)",
              color: "var(--bg, #0d1117)",
              border: "none",
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              textDecoration: "none",
            }}
            title="Download cryptographically signed Tagged PDF 1.7 report"
          >
            📥 Export Signed PDF
          </a>
        </div>
      </div>

      {/* Superseded / Reorg Warning */}
      {isReorg && (
        <div className="print-watermark-reorg">
          ⚠ SUPERSEDED BY REORG — Historical ledger data preserved for compliance and audit trail
        </div>
      )}

      <div className="card" style={{ display: "grid", gap: 12 }}>
        {ev.decode_status && (
          <Row
            label="Decode trust"
            value={
              <span title={ev.decode_warnings?.join(", ")}>
                {ev.decode_status === "verified" ? "Verified against registered ABI" : ev.decode_status === "heuristic" ? "Heuristic — no matching ABI" : "Unverified — ABI shape mismatch"}
              </span>
            }
          />
        )}
        <Row label="Description" value={ev.description} highlight />
        <Row label="Function" value={ev.function} badge />
        {ev.is_clawback && (
          <Row
            label={t("event.complianceTitle")}
            value={
              <span className="badge clawback" title={t("event.complianceTitle")}>
                {t("event.compliance")}
              </span>
            }
          />
        )}
        {ev.sac_side_effect && (
          <Row
            label={t("event.sacSideEffect")}
            value={
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  background:
                    ev.sac_side_effect === "account_created" ? "rgba(16,185,129,0.12)" : "rgba(59,130,246,0.12)",
                  border: `1px solid ${ev.sac_side_effect === "account_created" ? "#10b981" : "#3b82f6"}`,
                  borderRadius: 4,
                  fontSize: 12,
                  color: ev.sac_side_effect === "account_created" ? "#34d399" : "#60a5fa",
                }}
                title={ev.sac_side_effect === "account_created" ? t("event.sacCreatedTitle") : t("event.sacTrustlineTitle")}
              >
                {ev.sac_side_effect === "account_created"
                  ? t("event.sacCreated")
                  : t("event.sacTrustline")}
              </span>
            }
          />
        )}
        <Row label={t("event.ledger")} value={ev.ledger.toLocaleString()} />
        {ev.contract_id ? (
          <Row label={t("event.contract")} value={<Link to={`/contract/${ev.contract_id}`}>{ev.contract_id}</Link>} />
        ) : (
          <Row label={t("event.type")} value={t("event.classic")} />
        )}
        {ev.event_id && <Row label="Event ID" value={<Link to={`/event/${ev.event_id}`}>{ev.event_id}</Link>} mono />}
        {ev.tx_hash && <Row label="Tx Hash" value={ev.tx_hash} mono />}
        {narrative && narrative.event_count > 1 && <Row label="Transaction" value={narrative.sentence} />}
        {ev.raw_topics.length > 0 && <Row label="Topics" value={ev.raw_topics.join(", ")} mono />}
      </div>

      {/* Heuristic parameter guesses when no ABI is registered */}
      {ev.heuristic_params && <HeuristicParams params={ev.heuristic_params} />}

      {/* Fee-Bump sponsorship banner */}
      {ev.fee_bump && <FeeSponsorBanner feeBump={ev.fee_bump} />}

      {/* Factory Deployment Trace */}
      {ev.factory_deployment && <FactoryDeploymentTree deployment={ev.factory_deployment} />}

      {/* Resource Consumption breakdown */}
      <ResourceCosts event={ev} />

      <ProvenancePanel seq={ev.seq} />

      <DecodedProvenancePanel event={ev} />

      <XdrDecodedSplitView event={ev} />

      {/* CAP-0080 ZK host function cost delta */}
      {ev.zk_host_calls && <ZkCostDelta calls={ev.zk_host_calls.calls} delta={ev.zk_host_calls.delta} />}

      {/* Gas-Limit Alert Flag */}
      <GasLimitAlert event={ev} />

      {/* Storage tier breakdown */}
      {ev.storage_tiers && <StorageTierBreakdown tiers={ev.storage_tiers} />}

      {/* State restoration (RestoreFootprintOp) */}
      {ev.archival_info?.isRestoreOp && <RestoreFootprintPanel restore={ev.archival_info} />}

      {/* Dedicated print-only footer */}
      <div className="print-only print-footer">
        <div>
          <span>Audit URL: </span>
          <code>{window.location.href}</code>
        </div>
        <div>Certified Tagged PDF 1.7 &middot; SHA-256 Verified</div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  badge,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
  badge?: boolean;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <span style={{ color: "var(--muted)", minWidth: 100 }}>{label}</span>
      {badge ? (
        <FunctionBadge fn={String(value)} />
      ) : (
        <span
          style={{
            fontWeight: highlight ? 600 : 400,
            fontFamily: mono ? "monospace" : undefined,
            fontSize: mono ? 12 : undefined,
            wordBreak: "break-all",
          }}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function FunctionBadge({ fn }: { fn: string }) {
  const { t } = useTranslation();
  if (fn === "wrap_native") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span className="badge wrap">{t("event.wrapNative")}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("event.wrapDescription")}</span>
      </span>
    );
  }
  if (fn === "unwrap_native") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span className="badge unwrap">{t("event.unwrapNative")}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("event.unwrapDescription")}</span>
      </span>
    );
  }
  return <span className="badge green">{fn}</span>;
}
