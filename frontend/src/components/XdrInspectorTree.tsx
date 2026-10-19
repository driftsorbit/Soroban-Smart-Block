import React, { useState } from "react";
import { xdr, Address, StrKey } from "@stellar/stellar-sdk";

export type TreeNode =
  | string
  | number
  | boolean
  | null
  | { [key: string]: TreeNode }
  | TreeNode[];

export interface XdrInspectorTreeProps {
  title?: string;
  xdrBase64?: string | null;
  scVal?: xdr.ScVal | null;
  scValList?: xdr.ScVal[] | null;
  rawFallback?: boolean;
}

export function scValToTreeNode(val: xdr.ScVal): TreeNode {
  try {
    switch (val.switch()) {
      case xdr.ScValType.scvBool():
        return { bool: val.b() };
      case xdr.ScValType.scvVoid():
        return "void";
      case xdr.ScValType.scvU32():
        return { u32: val.u32() };
      case xdr.ScValType.scvI32():
        return { i32: val.i32() };
      case xdr.ScValType.scvU64():
        return { u64: val.u64().toString() };
      case xdr.ScValType.scvI64():
        return { i64: val.i64().toString() };
      case xdr.ScValType.scvU128(): {
        const u = val.u128();
        const big = (BigInt(u.hi().toString()) << 64n) | BigInt(u.lo().toString());
        return { u128: big.toString() };
      }
      case xdr.ScValType.scvI128(): {
        const i = val.i128();
        const hi = BigInt(i.hi().toString());
        const lo = BigInt(i.lo().toString());
        const unsigned = (hi << 64n) | lo;
        const signed = unsigned >= (1n << 127n) ? unsigned - (1n << 128n) : unsigned;
        return { i128: signed.toString() };
      }
      case xdr.ScValType.scvBytes():
        return { bytes: val.bytes().toString("hex") };
      case xdr.ScValType.scvString():
        return { string: val.str().toString() };
      case xdr.ScValType.scvSymbol():
        return { symbol: val.sym().toString() };
      case xdr.ScValType.scvAddress(): {
        try {
          return { address: Address.fromScVal(val).toString() };
        } catch {
          return { address: "unknown" };
        }
      }
      case xdr.ScValType.scvVec(): {
        const items = val.vec() || [];
        return { vec: items.map(scValToTreeNode) };
      }
      case xdr.ScValType.scvMap(): {
        const entries = val.map() || [];
        const obj: Record<string, TreeNode> = {};
        entries.forEach((e, idx) => {
          const k = scValToTreeNode(e.key());
          const kStr = typeof k === "string" ? k : JSON.stringify(k);
          obj[kStr || `entry_${idx}`] = scValToTreeNode(e.val());
        });
        return { map: obj };
      }
      case xdr.ScValType.scvContractInstance():
        return { contractInstance: "wasm-contract-instance" };
      case xdr.ScValType.scvLedgerKeyContractInstance():
        return "ledgerKeyContractInstance";
      case xdr.ScValType.scvLedgerKeyNonce():
        return { ledgerKeyNonce: String(val.nonceKey()?.nonce()) };
      default:
        return { unknownScVal: val.switch().name || "unknown" };
    }
  } catch (err: any) {
    return { rawFallback: val.toXDR ? val.toXDR("base64") : String(val), error: err.message };
  }
}

export function decodeXdrPayload(
  rawB64: string,
): { tree: TreeNode; label: string; isFallback?: boolean } | { error: string } {
  const trimmed = rawB64.trim();
  if (!trimmed) {
    return { error: "Empty XDR input." };
  }

  // Check valid base64
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return { error: "Invalid Base64 XDR string." };
  }

  // 1. Try ScVal
  try {
    const parsed = xdr.ScVal.fromXDR(trimmed, "base64");
    return { tree: scValToTreeNode(parsed), label: `ScVal (${parsed.switch().name})` };
  } catch {}

  // 2. Try ContractEvent
  try {
    const ev = xdr.ContractEvent.fromXDR(trimmed, "base64");
    const body = ev.body();
    let topics: TreeNode[] = [];
    let dataNode: TreeNode = "none";
    if ((body as any).arm?.() === "v0" || typeof (body as any).v0 === "function") {
      const v0 = (body as any).v0();
      topics = (v0.topics() || []).map(scValToTreeNode);
      dataNode = scValToTreeNode(v0.data());
    }
    return {
      tree: {
        type: ev.type().name,
        contractId: ev.contractId() ? Address.contract(Buffer.from(ev.contractId() as any)).toString() : null,
        topics,
        data: dataNode,
      },
      label: "ContractEvent",
    };
  } catch {}

  // 3. Try TransactionEnvelope
  try {
    const env = xdr.TransactionEnvelope.fromXDR(trimmed, "base64");
    return {
      tree: {
        envelopeType: env.switch().name,
      },
      label: "TransactionEnvelope",
    };
  } catch {}

  // 4. Try SorobanTransactionData
  try {
    const data = xdr.SorobanTransactionData.fromXDR(trimmed, "base64");
    const res = data.resources();
    const diskRead = typeof (res as any).diskReadBytes === "function" ? (res as any).diskReadBytes() : (res as any).readBytes?.() ?? 0;
    return {
      tree: {
        instructions: res.instructions(),
        readBytes: diskRead,
        writeBytes: res.writeBytes(),
        footprint: {
          readOnlyCount: res.footprint().readOnly().length,
          readWriteCount: res.footprint().readWrite().length,
        },
      },
      label: "SorobanTransactionData",
    };
  } catch {}

  // Raw Fallback for unknown / unrecognized types
  return {
    tree: {
      type: "Unknown / Unrecognized XDR",
      rawBase64: trimmed,
      byteLength: Math.floor((trimmed.length * 3) / 4),
      fallbackReason: "Type schema not recognized by standard Soroban decoders",
    },
    label: "Raw Fallback",
    isFallback: true,
  };
}

function CopyBtn({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title={label ? `Copy ${label}` : "Copy value"}
      style={{
        background: "transparent",
        color: copied ? "var(--green, #3fb950)" : "var(--muted, #8b949e)",
        border: "1px solid var(--border, #30363d)",
        borderRadius: "3px",
        padding: "1px 5px",
        fontSize: "10px",
        cursor: "pointer",
        marginLeft: "6px",
      }}
    >
      {copied ? "✓ Copied" : "⎘"}
    </button>
  );
}

function TreeNodeViewer({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const indent = depth * 12;

  if (node === null || node === undefined) {
    return <span style={{ color: "var(--muted, #8b949e)", fontStyle: "italic" }}>null</span>;
  }

  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    const valStr = String(node);
    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <span style={{ color: typeof node === "string" ? "var(--green, #3fb950)" : "var(--accent, #58a6ff)" }}>
          {typeof node === "string" ? `"${node}"` : valStr}
        </span>
        <CopyBtn value={valStr} />
      </span>
    );
  }

  if (Array.isArray(node)) {
    if (node.length === 0) return <span style={{ color: "var(--muted, #8b949e)" }}>[]</span>;
    return (
      <span>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--accent, #58a6ff)",
            padding: "0 4px",
            fontSize: "11px",
            cursor: "pointer",
          }}
        >
          {collapsed ? "▶" : "▼"} [{node.length}]
        </button>
        {!collapsed && (
          <div style={{ marginLeft: indent + 8, borderLeft: "1px dashed var(--border, #30363d)", paddingLeft: "6px" }}>
            {node.map((item, i) => (
              <div key={i} style={{ marginTop: "2px" }}>
                <span style={{ color: "var(--muted, #8b949e)", fontSize: "11px" }}>[{i}]: </span>
                <TreeNodeViewer node={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  const entries = Object.entries(node);
  return (
    <div style={{ marginLeft: depth > 0 ? indent : 0 }}>
      {entries.map(([k, v]) => {
        const isLeaf = typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null;
        return (
          <div key={k} style={{ marginTop: "3px" }}>
            <span style={{ color: "var(--accent, #58a6ff)", fontWeight: 600, fontSize: "11px" }}>{k}: </span>
            {isLeaf ? (
              <TreeNodeViewer node={v} depth={depth + 1} />
            ) : (
              <div style={{ marginLeft: "12px", borderLeft: "1px dashed var(--border, #30363d)", paddingLeft: "6px" }}>
                <TreeNodeViewer node={v} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const XdrInspectorTree: React.FC<XdrInspectorTreeProps> = ({
  title,
  xdrBase64,
  scVal,
  scValList,
  rawFallback = true,
}) => {
  const [copyTreeDone, setCopyTreeDone] = useState(false);

  // If directly provided ScVal list (e.g. simulation inputs)
  if (scValList && scValList.length > 0) {
    const tree = scValList.map((sv, idx) => ({ [`arg_${idx}`]: scValToTreeNode(sv) }));
    const handleCopyAll = () => {
      navigator.clipboard.writeText(JSON.stringify(tree, null, 2));
      setCopyTreeDone(true);
      setTimeout(() => setCopyTreeDone(false), 1500);
    };

    return (
      <div
        data-testid="xdr-inspector-tree"
        style={{
          border: "1px solid var(--border, #30363d)",
          borderRadius: "6px",
          padding: "8px",
          backgroundColor: "var(--surface, #161b22)",
          fontSize: "12px",
          margin: "6px 0",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <strong>{title || `Arguments XDR Tree (${scValList.length})`}</strong>
          <button
            onClick={handleCopyAll}
            style={{
              background: "transparent",
              border: "1px solid var(--border, #30363d)",
              color: copyTreeDone ? "var(--green, #3fb950)" : "var(--muted, #8b949e)",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            {copyTreeDone ? "✓ Copied JSON" : "⎘ Copy JSON"}
          </button>
        </div>
        <TreeNodeViewer node={tree} />
      </div>
    );
  }

  // If directly provided single ScVal
  if (scVal) {
    const tree = scValToTreeNode(scVal);
    const handleCopyAll = () => {
      navigator.clipboard.writeText(JSON.stringify(tree, null, 2));
      setCopyTreeDone(true);
      setTimeout(() => setCopyTreeDone(false), 1500);
    };

    return (
      <div
        data-testid="xdr-inspector-tree"
        style={{
          border: "1px solid var(--border, #30363d)",
          borderRadius: "6px",
          padding: "8px",
          backgroundColor: "var(--surface, #161b22)",
          fontSize: "12px",
          margin: "6px 0",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <strong>{title || "ScVal XDR Tree"}</strong>
          <button
            onClick={handleCopyAll}
            style={{
              background: "transparent",
              border: "1px solid var(--border, #30363d)",
              color: copyTreeDone ? "var(--green, #3fb950)" : "var(--muted, #8b949e)",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            {copyTreeDone ? "✓ Copied JSON" : "⎘ Copy JSON"}
          </button>
        </div>
        <TreeNodeViewer node={tree} />
      </div>
    );
  }

  // Empty state
  if (!xdrBase64 || !xdrBase64.trim()) {
    return (
      <div
        data-testid="xdr-inspector-empty"
        style={{
          border: "1px dashed var(--border, #30363d)",
          borderRadius: "6px",
          padding: "10px",
          color: "var(--muted, #8b949e)",
          fontSize: "12px",
          fontStyle: "italic",
          margin: "6px 0",
        }}
      >
        {title ? `${title}: No XDR data provided.` : "No XDR data to inspect."}
      </div>
    );
  }

  const decoded = decodeXdrPayload(xdrBase64);

  // Invalid-input state
  if ("error" in decoded) {
    return (
      <div
        data-testid="xdr-inspector-error"
        style={{
          border: "1px solid #f48771",
          borderRadius: "6px",
          padding: "8px",
          backgroundColor: "rgba(244, 135, 113, 0.1)",
          fontSize: "12px",
          margin: "6px 0",
        }}
      >
        <div style={{ color: "#f48771", fontWeight: 600 }}>✗ {decoded.error}</div>
        {rawFallback && (
          <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "var(--muted, #8b949e)", wordBreak: "break-all" }}>Raw: {xdrBase64}</span>
            <CopyBtn value={xdrBase64} label="raw XDR" />
          </div>
        )}
      </div>
    );
  }

  const handleCopyAll = () => {
    navigator.clipboard.writeText(JSON.stringify(decoded.tree, null, 2));
    setCopyTreeDone(true);
    setTimeout(() => setCopyTreeDone(false), 1500);
  };

  return (
    <div
      data-testid="xdr-inspector-tree"
      style={{
        border: "1px solid var(--border, #30363d)",
        borderRadius: "6px",
        padding: "8px",
        backgroundColor: "var(--surface, #161b22)",
        fontSize: "12px",
        margin: "6px 0",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <strong>{title || decoded.label}</strong>
          {decoded.isFallback && (
            <span
              style={{
                backgroundColor: "#d29922",
                color: "#000",
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "999px",
                fontWeight: 600,
              }}
            >
              Raw Fallback
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <CopyBtn value={xdrBase64} label="Raw Base64" />
          <button
            onClick={handleCopyAll}
            style={{
              background: "transparent",
              border: "1px solid var(--border, #30363d)",
              color: copyTreeDone ? "var(--green, #3fb950)" : "var(--muted, #8b949e)",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            {copyTreeDone ? "✓ Copied JSON" : "⎘ Copy JSON"}
          </button>
        </div>
      </div>
      <TreeNodeViewer node={decoded.tree} />
    </div>
  );
};

export default XdrInspectorTree;
