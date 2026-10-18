import React, { useState, useRef, useEffect, Suspense, lazy } from "react";
import "../styles/Sandbox.css";
import FileExplorer from "../components/FileExplorer";
import Terminal from "../components/Terminal";
import Preview from "../components/Preview";
import ActionBar from "../components/ActionBar";
import TemplateSelector from "../components/TemplateSelector";
import { initWebContainer, mountFiles, runCommand, SandboxFile } from "../services/webcontainer";
import { getTemplate } from "../services/templates";
import { generateSandboxId } from "../services/export";
import {
  saveSandbox,
  LocalSandboxHost,
  SimulationResult,
  parseArgs,
  simulateRemote,
  replayScenario,
  compareProtocols,
  listCollections,
  saveCollection,
  exportCollection,
  importCollection,
  validateSimulationAuth,
  AuthValidationResult,
  ReplayResult,
  ProtocolComparisonResult,
  ScenarioCollection,
} from "../services/sandbox-api";
import { createAutoSaver } from "../services/session";
import { WebContainer } from "@webcontainer/api";

const Editor = lazy(() => import("../components/Editor"));

/** Contract simulation, auth validation, replay, protocol comparison, and scenario collections (#1090-#1093). */
const SimulationPanel: React.FC = () => {
  const hostRef = useRef<LocalSandboxHost | null>(null);
  const [activeTab, setActiveTab] = useState<"simulate" | "replay" | "protocols" | "collections">("simulate");
  const [local, setLocal] = useState(false);
  const [contractId, setContractId] = useState("");
  const [fn, setFn] = useState("");
  const [args, setArgs] = useState("[]");
  const [sourceAccount, setSourceAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);

  // Auth Validation state (#1093)
  const [authValidation, setAuthValidation] = useState<AuthValidationResult | null>(null);

  // Replay state (#1090)
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [scenarioName, setScenarioName] = useState("");
  const [ledgerSeq, setLedgerSeq] = useState("100000");
  const [timestamp, setTimestamp] = useState(String(Math.floor(Date.now() / 1000)));

  // Protocol Comparison state (#1091)
  const [protocolResult, setProtocolResult] = useState<ProtocolComparisonResult | null>(null);

  // Scenario Collections state (#1092)
  const [collections, setCollections] = useState<Array<{ id: string; name: string; scenarioCount: number }>>([]);
  const [collectionName, setCollectionName] = useState("");
  const [importJson, setImportJson] = useState("");

  const host = async () => {
    if (!hostRef.current) {
      hostRef.current = new LocalSandboxHost();
      const info = await hostRef.current.init();
      setStatus(`Local host ready (protocol ${info.protocolVersion})`);
    }
    return hostRef.current;
  };

  const withBusy = async (fnc: () => Promise<void>) => {
    setBusy(true);
    try {
      await fnc();
    } catch (err) {
      setStatus(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const importState = () =>
    withBusy(async () => {
      const n = await (await host()).importState(contractId, fn, parseArgs(args));
      setStatus(`Imported ${n} ledger entries from the network`);
    });

  const handleValidateAuth = () =>
    withBusy(async () => {
      const parsed = parseArgs(args);
      const res = await validateSimulationAuth(contractId, fn, parsed, [], sourceAccount || undefined);
      setAuthValidation(res);
      setStatus(res.valid ? "✓ Authorization valid" : `⚠ ${res.explanation}`);
    });

  const simulate = () =>
    withBusy(async () => {
      const a = parseArgs(args);
      // Automatically validate auth requirements before simulation
      try {
        const authRes = await validateSimulationAuth(contractId, fn, a, [], sourceAccount || undefined);
        setAuthValidation(authRes);
      } catch {
        // Fall back gracefully if auth validation endpoint is unavailable
      }
      setResult(local ? await (await host()).simulate(contractId, fn, a) : await simulateRemote(contractId, fn, a));
    });

  const handleReplay = () =>
    withBusy(async () => {
      const parsed = parseArgs(args);
      const res = await replayScenario({
        name: scenarioName || `${fn} on ${contractId.slice(0, 8)}...`,
        contractId,
        fn,
        args: parsed,
        env: {
          sequence: Number(ledgerSeq) || 100000,
          timestamp: Number(timestamp) || Math.floor(Date.now() / 1000),
          protocolVersion: 20,
        },
        baselineResult: result
          ? {
              returnValue: result.returnValue,
              error: result.error,
              cost: { cpuInsns: result.cpuInsns, memBytes: result.memBytes },
              events: result.events,
            }
          : undefined,
      });
      setReplayResult(res);
      setStatus(
        res.isLedgerDependent
          ? `⚠ Replayed: Ledger-dependent results flagged (${res.ledgerDependencies.length} dependency)`
          : `✓ Replayed: Deterministic result verified`,
      );
    });

  const handleCompareProtocols = () =>
    withBusy(async () => {
      const parsed = parseArgs(args);
      const res = await compareProtocols(contractId, fn, parsed, [20, 21, 22]);
      setProtocolResult(res);
      setStatus(`✓ Protocol comparison completed: ${res.comparisons.length} versions analyzed`);
    });

  const loadCollections = async () => {
    try {
      const data = await listCollections(50);
      setCollections(data.collections);
    } catch (e) {
      console.warn("Could not load collections:", e);
    }
  };

  useEffect(() => {
    if (activeTab === "collections") {
      loadCollections();
    }
  }, [activeTab]);

  const handleSaveToCollection = () =>
    withBusy(async () => {
      if (!collectionName.trim()) {
        setStatus("✗ Please provide a collection name");
        return;
      }
      const parsed = parseArgs(args);
      const res = await saveCollection({
        name: collectionName.trim(),
        scenarios: [
          {
            name: scenarioName || `${fn} scenario`,
            contractId,
            fn,
            args: parsed,
            env: {
              sequence: Number(ledgerSeq) || 100000,
              timestamp: Number(timestamp) || Math.floor(Date.now() / 1000),
            },
          },
        ],
      });
      setStatus(`✓ Saved to collection '${res.collection.name}' (secrets stripped: ${res.strippedSecretsCount})`);
      setCollectionName("");
      loadCollections();
    });

  const handleExport = (colId: string) =>
    withBusy(async () => {
      const exported = await exportCollection(colId);
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scenario-collection-${colId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`✓ Exported collection safely without secrets (stripped: ${exported.strippedSecretsCount})`);
    });

  const handleImport = () =>
    withBusy(async () => {
      if (!importJson.trim()) {
        setStatus("✗ Please paste JSON to import");
        return;
      }
      const imported = await importCollection(importJson);
      setStatus(
        `✓ Imported collection '${imported.collection.name}' (secrets sanitized: ${imported.strippedSecretsCount})`,
      );
      setImportJson("");
      loadCollections();
    });

  return (
    <div className="preview">
      <div
        className="preview-header"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span>Contract Sandbox</span>
      </div>
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          fontSize: "11px",
        }}
      >
        <button
          style={{
            flex: 1,
            padding: "6px",
            background: activeTab === "simulate" ? "var(--bg)" : "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontWeight: activeTab === "simulate" ? "bold" : "normal",
          }}
          onClick={() => setActiveTab("simulate")}
        >
          Simulate
        </button>
        <button
          style={{
            flex: 1,
            padding: "6px",
            background: activeTab === "replay" ? "var(--bg)" : "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontWeight: activeTab === "replay" ? "bold" : "normal",
          }}
          onClick={() => setActiveTab("replay")}
        >
          Replay (#1090)
        </button>
        <button
          style={{
            flex: 1,
            padding: "6px",
            background: activeTab === "protocols" ? "var(--bg)" : "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontWeight: activeTab === "protocols" ? "bold" : "normal",
          }}
          onClick={() => setActiveTab("protocols")}
        >
          Protocols (#1091)
        </button>
        <button
          style={{
            flex: 1,
            padding: "6px",
            background: activeTab === "collections" ? "var(--bg)" : "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontWeight: activeTab === "collections" ? "bold" : "normal",
          }}
          onClick={() => setActiveTab("collections")}
        >
          Collections (#1092)
        </button>
      </div>

      <div className="preview-content" style={{ fontSize: "12px", display: "grid", gap: "6px", padding: "8px" }}>
        <input
          placeholder="Contract ID (C…)"
          value={contractId}
          onChange={(e) => setContractId(e.target.value.trim())}
        />
        <input placeholder="Function" value={fn} onChange={(e) => setFn(e.target.value.trim())} />
        <input
          placeholder='Args (JSON array), e.g. ["G…", 100]'
          value={args}
          onChange={(e) => setArgs(e.target.value)}
        />

        {activeTab === "simulate" && (
          <>
            <input
              placeholder="Source Account (optional G…)"
              value={sourceAccount}
              onChange={(e) => setSourceAccount(e.target.value.trim())}
            />
            <label>
              <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} /> Local execution
              (offline host)
            </label>
            <div style={{ display: "flex", gap: "6px" }}>
              {local && (
                <button onClick={importState} disabled={busy || !contractId || !fn}>
                  Import state
                </button>
              )}
              <button onClick={handleValidateAuth} disabled={busy || !contractId || !fn}>
                Validate Auth (#1093)
              </button>
              <button onClick={simulate} disabled={busy || !contractId || !fn} style={{ fontWeight: "bold" }}>
                {busy ? "Working…" : "Simulate"}
              </button>
            </div>

            {authValidation && (
              <div
                data-testid="auth-validation-result"
                style={{
                  background: authValidation.valid ? "rgba(46,160,67,0.15)" : "rgba(244,135,113,0.15)",
                  padding: "6px",
                  borderRadius: "4px",
                }}
              >
                <div style={{ fontWeight: "bold", color: authValidation.valid ? "#2ea043" : "#f48771" }}>
                  {authValidation.valid ? "✓ Auth Requirements Satisfied" : "⚠ Missing or Malformed Auth Requirements"}
                </div>
                <div style={{ fontSize: "11px", marginTop: "2px" }}>{authValidation.explanation}</div>
                {authValidation.missing.length > 0 && (
                  <div style={{ marginTop: "4px", fontSize: "11px", color: "#f48771" }}>
                    Missing: {authValidation.missing.map((m) => `${m.signer} for ${m.scope}`).join(", ")}
                  </div>
                )}
              </div>
            )}

            {result && (
              <div data-testid="simulation-result">
                {result.warnings.map((w) => (
                  <div key={w} style={{ color: "#e5c07b" }}>
                    ⚠ {w}
                  </div>
                ))}
                {result.error ? (
                  <div style={{ color: "#f48771" }}>✗ {result.error}</div>
                ) : (
                  <div>Return value (XDR): {result.returnValue}</div>
                )}
                <div>
                  Budget ({result.mode}): {result.cpuInsns.toLocaleString()} CPU · {result.memBytes.toLocaleString()}{" "}
                  bytes mem
                </div>
                <div>
                  Events: {result.events.length} · State changes: {result.stateDiff.length}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "replay" && (
          <div style={{ display: "grid", gap: "6px" }}>
            <input
              placeholder="Scenario Name (optional)"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
              <input placeholder="Ledger Seq" value={ledgerSeq} onChange={(e) => setLedgerSeq(e.target.value)} />
              <input placeholder="Timestamp" value={timestamp} onChange={(e) => setTimestamp(e.target.value)} />
            </div>
            <button onClick={handleReplay} disabled={busy || !contractId || !fn}>
              {busy ? "Replaying…" : "Replay Scenario (#1090)"}
            </button>
            {replayResult && (
              <div
                data-testid="replay-result"
                style={{ background: "rgba(255,255,255,0.05)", padding: "6px", borderRadius: "4px" }}
              >
                <div>
                  Deterministic: <strong>{replayResult.isDeterministic ? "Yes ✓" : "No ✗"}</strong>
                </div>
                <div style={{ color: replayResult.isLedgerDependent ? "#f48771" : "#2ea043" }}>
                  Ledger Dependent: <strong>{replayResult.isLedgerDependent ? "Yes ⚠" : "No (Pure) ✓"}</strong>
                </div>
                {replayResult.warning && (
                  <div style={{ color: "#e5c07b", fontSize: "11px" }}>{replayResult.warning}</div>
                )}
                {replayResult.ledgerDependencies.length > 0 && (
                  <ul style={{ paddingLeft: "16px", margin: "4px 0", fontSize: "11px" }}>
                    {replayResult.ledgerDependencies.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
                <div style={{ fontSize: "11px" }}>
                  CPU: {replayResult.replayResult.cost.cpuInsns.toLocaleString()} · Mem:{" "}
                  {replayResult.replayResult.cost.memBytes.toLocaleString()} bytes
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "protocols" && (
          <div style={{ display: "grid", gap: "6px" }}>
            <button onClick={handleCompareProtocols} disabled={busy || !contractId || !fn}>
              {busy ? "Comparing…" : "Compare Protocols (20, 21, 22) (#1091)"}
            </button>
            {protocolResult && (
              <div data-testid="protocol-comparison-result" style={{ fontSize: "11px" }}>
                <div style={{ fontWeight: "bold", marginBottom: "4px" }}>{protocolResult.summary}</div>
                {protocolResult.comparisons.map((c) => (
                  <div
                    key={c.protocol}
                    style={{
                      border: "1px solid var(--border)",
                      padding: "4px",
                      marginBottom: "4px",
                      borderRadius: "4px",
                    }}
                  >
                    <div style={{ fontWeight: "bold", color: "#61afef" }}>{c.label}</div>
                    <div>
                      Status: {c.environment.status} · Network: {c.environment.network}
                    </div>
                    <div>
                      CPU: {c.cost.cpuInsns.toLocaleString()} · Memory: {c.cost.memBytes.toLocaleString()} bytes
                    </div>
                    <div>Est. Fee: {c.minResourceFee} stroops</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "collections" && (
          <div style={{ display: "grid", gap: "6px" }}>
            <input
              placeholder="New Collection Name"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
            />
            <button onClick={handleSaveToCollection} disabled={busy || !contractId || !fn || !collectionName.trim()}>
              Save Current Scenario to Collection (#1092)
            </button>
            <div style={{ fontWeight: "bold", marginTop: "4px" }}>Saved Collections ({collections.length}):</div>
            {collections.map((col) => (
              <div
                key={col.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: "1px solid var(--border)",
                  padding: "2px 0",
                }}
              >
                <span>
                  {col.name} ({col.scenarioCount})
                </span>
                <button style={{ fontSize: "10px", padding: "2px 6px" }} onClick={() => handleExport(col.id)}>
                  Export
                </button>
              </div>
            ))}
            <div style={{ marginTop: "6px" }}>
              <textarea
                placeholder="Paste exported JSON collection to import..."
                rows={2}
                style={{ width: "100%", fontSize: "10px" }}
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
              />
              <button onClick={handleImport} disabled={busy || !importJson.trim()}>
                Import Collection (No Secrets)
              </button>
            </div>
          </div>
        )}

        {status && (
          <div
            style={{
              fontSize: "11px",
              color: status.startsWith("✗") ? "#f48771" : status.startsWith("⚠") ? "#e5c07b" : "#98c379",
            }}
          >
            {status}
          </div>
        )}
      </div>
    </div>
  );
};

const Sandbox: React.FC = () => {
  const [files, setFiles] = useState<Map<string, SandboxFile>>(new Map());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(true);
  const [sandboxId] = useState(generateSandboxId());
  const [templateId, setTemplateId] = useState<string>("");
  const webcontainerRef = useRef<WebContainer | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const autoSaverRef = useRef<(() => void) | null>(null);

  const initializeSandbox = async (templateId: string) => {
    setIsInitializing(true);
    setTemplateId(templateId);
    try {
      const container = await initWebContainer();
      webcontainerRef.current = container;

      const template = getTemplate(templateId);
      if (!template) throw new Error("Template not found");

      const templateMap = new Map(Object.entries(template.files));
      setFiles(templateMap);
      setSelectedFile(Object.keys(template.files)[0]);

      await mountFiles(container, templateMap);

      // Start auto-saver
      if (autoSaverRef.current) autoSaverRef.current();
      autoSaverRef.current = createAutoSaver(sandboxId, templateId, templateMap, Object.keys(template.files)[0]);

      // Persist to backend
      await saveSandbox(sandboxId, templateId, templateMap);

      setTerminalOutput(["> Sandbox initialized with " + template.name]);
      setShowTemplateSelector(false);
    } catch (error) {
      console.error("Initialization error:", error);
      setTerminalOutput([
        "✗ Failed to initialize WebContainer",
        "Note: WebContainer requires COOP/COEP headers. Running in demo mode.",
      ]);
      setShowTemplateSelector(false);
    } finally {
      setIsInitializing(false);
    }
  };

  const currentFile = selectedFile ? files.get(selectedFile) : null;

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
  };

  const handleFileChange = (content: string) => {
    if (selectedFile) {
      const updatedFile = { ...files.get(selectedFile)!, content };
      const newFiles = new Map(files).set(selectedFile, updatedFile);
      setFiles(newFiles);
    }
  };

  // Auto-persist files when they change
  useEffect(() => {
    if (files.size > 0 && templateId && sandboxId) {
      saveSandbox(sandboxId, templateId, files).catch((error) => {
        console.warn("Failed to auto-save:", error);
      });
    }
  }, [files, templateId, sandboxId]);

  const handleRun = async () => {
    if (!webcontainerRef.current) {
      setTerminalOutput((prev) => [...prev, "✗ WebContainer not available"]);
      return;
    }

    setIsRunning(true);
    setTerminalOutput((prev) => [...prev, "$ npm start", ""]);

    try {
      await runCommand(webcontainerRef.current, "npm install", (line) => {
        setTerminalOutput((prev) => [...prev, line]);
      });

      await runCommand(webcontainerRef.current, "npm start", (line) => {
        setTerminalOutput((prev) => [...prev, line]);
      });
    } catch (error) {
      setTerminalOutput((prev) => [...prev, `✗ Error: ${error instanceof Error ? error.message : "Unknown error"}`]);
    } finally {
      setIsRunning(false);
    }
  };

  if (showTemplateSelector) {
    return (
      <div className="sandbox-container">
        <div className="sandbox-header">
          <h1>Soroban Sandbox</h1>
        </div>
        <TemplateSelector onSelect={initializeSandbox} />
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className="sandbox-container">
        <div className="sandbox-header">
          <h1>Soroban Sandbox</h1>
        </div>
        <div className="placeholder">Initializing WebContainer...</div>
      </div>
    );
  }

  return (
    <div className="sandbox-container">
      <div className="sandbox-header">
        <h1>Soroban Sandbox</h1>
        <button onClick={handleRun} disabled={isRunning}>
          {isRunning ? "Running..." : "Run"}
        </button>
      </div>

      <ActionBar files={files} sandboxId={sandboxId} />

      <div className="sandbox-layout">
        <FileExplorer files={Array.from(files.values())} selectedFile={selectedFile} onSelectFile={handleFileSelect} />

        <div className="editor-section">
          {currentFile ? (
            <Suspense fallback={<div className="placeholder">Loading editor...</div>}>
              <Editor file={currentFile} onChange={handleFileChange} />
            </Suspense>
          ) : (
            <div className="placeholder">Select a file to edit</div>
          )}
        </div>

        <div className="right-panel">
          <Preview packageJsonContent={files.get("package.json")?.content || ""} />
          <SimulationPanel />
          <Terminal output={terminalOutput} />
        </div>
      </div>
    </div>
  );
};

export default Sandbox;
