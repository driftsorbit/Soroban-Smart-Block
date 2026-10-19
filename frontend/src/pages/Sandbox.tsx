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
  ResourceBudget,
  parseArgs,
  simulateRemote,
  createCheckpoint,
} from "../services/sandbox-api";
import { createAutoSaver } from "../services/session";
import { WebContainer } from "@webcontainer/api";
import XdrInspectorTree from "../components/XdrInspectorTree";
import SimulationBudgetDeltas from "../components/SimulationBudgetDeltas";
import TestVectorsPanel from "../components/TestVectorsPanel";
import CheckpointManager from "../components/CheckpointManager";

const Editor = lazy(() => import("../components/Editor"));

interface SimulationPanelProps {
  sandboxId?: string;
  files?: Map<string, SandboxFile>;
  onResetFiles?: (files: Map<string, SandboxFile>) => void;
}

/** Contract simulation via the RPC proxy or the in-browser Soroban host (#925, #1094, #1096, #1097, #1098). */
const SimulationPanel: React.FC<SimulationPanelProps> = ({ sandboxId = "", files = new Map(), onResetFiles }) => {
  const hostRef = useRef<LocalSandboxHost | null>(null);
  const previousBudgetRef = useRef<ResourceBudget | null>(null);
  const [local, setLocal] = useState(false);
  const [contractId, setContractId] = useState("");
  const [fn, setFn] = useState("");
  const [args, setArgs] = useState("[]");
  const [sourceAccount, setSourceAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [activeTab, setActiveTab] = useState<"simulate" | "vectors" | "xdr" | "checkpoints">("simulate");
  const [customXdrInput, setCustomXdrInput] = useState("");

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
      const res = local
        ? await (await host()).simulate(contractId, fn, a, previousBudgetRef.current)
        : await simulateRemote(contractId, fn, a, previousBudgetRef.current);
      setResult(res);

      // Save previous budget for next simulation delta comparison (#1096)
      previousBudgetRef.current = {
        cpuInsns: res.cpuInsns,
        memBytes: res.memBytes,
        ledgerIO: res.ledgerIO,
        minResourceFee: res.minResourceFee,
        ledgerIOUnavailable: res.ledgerIOUnavailable,
        feeUnavailable: res.feeUnavailable,
      };
    });

  let parsedInputArgs: any[] | null = null;
  let parseInputError: string | null = null;
  try {
    parsedInputArgs = parseArgs(args);
  } catch (err: any) {
    parseInputError = err.message;
  }

  return (
    <div className="preview">
      <div className="preview-header">Contract Simulation & Tools</div>
      <div style={{ display: "flex", gap: "2px", borderBottom: "1px solid var(--border)", padding: "4px 8px", background: "var(--surface)" }}>
        <button
          onClick={() => setActiveTab("simulate")}
          style={{
            background: activeTab === "simulate" ? "var(--accent)" : "transparent",
            color: activeTab === "simulate" ? "var(--accent-contrast, #fff)" : "var(--text)",
            border: "none",
            borderRadius: "3px",
            fontSize: "11px",
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          Simulate
        </button>
        <button
          onClick={() => setActiveTab("vectors")}
          style={{
            background: activeTab === "vectors" ? "var(--accent)" : "transparent",
            color: activeTab === "vectors" ? "var(--accent-contrast, #fff)" : "var(--text)",
            border: "none",
            borderRadius: "3px",
            fontSize: "11px",
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          Test Vectors
        </button>
        <button
          onClick={() => setActiveTab("xdr")}
          style={{
            background: activeTab === "xdr" ? "var(--accent)" : "transparent",
            color: activeTab === "xdr" ? "var(--accent-contrast, #fff)" : "var(--text)",
            border: "none",
            borderRadius: "3px",
            fontSize: "11px",
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          XDR Inspector
        </button>
        <button
          onClick={() => setActiveTab("checkpoints")}
          style={{
            background: activeTab === "checkpoints" ? "var(--accent)" : "transparent",
            color: activeTab === "checkpoints" ? "var(--accent-contrast, #fff)" : "var(--text)",
            border: "none",
            borderRadius: "3px",
            fontSize: "11px",
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          Checkpoints
        </button>
      </div>

      <div className="preview-content" style={{ fontSize: "12px", display: "grid", gap: "6px" }}>
        {activeTab === "simulate" && (
          <>
            <label>
              <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} /> Local execution (offline, in-browser host)
            </label>
            <input placeholder="Contract ID (C…)" value={contractId} onChange={(e) => setContractId(e.target.value.trim())} />
            <input placeholder="Function" value={fn} onChange={(e) => setFn(e.target.value.trim())} />
            <input placeholder='Args (JSON array), e.g. ["G…", 100]' value={args} onChange={(e) => setArgs(e.target.value)} />
            <div>
              {local && (
                <button onClick={importState} disabled={busy || !contractId || !fn}>
                  Import state
                </button>
              )}{" "}
              <button onClick={simulate} disabled={busy || !contractId || !fn}>
                {busy ? "Working…" : "Simulate"}
              </button>
            </div>
            {status && <div>{status}</div>}

            {/* Resource budget deltas (#1096) */}
            <SimulationBudgetDeltas
              currentBudget={
                result
                  ? {
                      cpuInsns: result.cpuInsns,
                      memBytes: result.memBytes,
                      ledgerIO: result.ledgerIO,
                      minResourceFee: result.minResourceFee,
                      ledgerIOUnavailable: result.ledgerIOUnavailable,
                      feeUnavailable: result.feeUnavailable,
                    }
                  : null
              }
              deltas={result?.budgetDeltas}
              mode={result?.mode ?? (local ? "local" : "remote")}
              error={result?.error}
            />

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
                  <XdrInspectorTree title="Return Value (XDR Tree)" xdrBase64={result.returnValue} />
                )}
                {result.events && result.events.length > 0 && (
                  <div style={{ marginTop: "4px" }}>
                    <div style={{ fontWeight: 600, fontSize: "11px", color: "var(--muted)" }}>Events ({result.events.length}):</div>
                    {result.events.map((ev, i) => (
                      <XdrInspectorTree key={i} title={`Event #${i + 1}`} xdrBase64={ev} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "vectors" && (
          <TestVectorsPanel
            onSelectVector={(newArgs) => {
              setArgs(newArgs);
              setActiveTab("simulate");
            }}
          />
        )}

        {activeTab === "xdr" && (
          <div>
            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Simulation Input XDR Inspector</div>
              {parseInputError ? (
                <div style={{ color: "#f48771", fontSize: "11px" }}>✗ Invalid JSON arguments: {parseInputError}</div>
              ) : parsedInputArgs && parsedInputArgs.length > 0 ? (
                <XdrInspectorTree title="Input Arguments (XDR Tree)" scValList={parsedInputArgs} />
              ) : (
                <div style={{ color: "var(--muted)", fontStyle: "italic", fontSize: "11px" }}>No input arguments provided.</div>
              )}
            </div>

            <div style={{ marginBottom: "8px" }}>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Simulation Output XDR Inspector</div>
              {result?.returnValue ? (
                <XdrInspectorTree title="Return Value (XDR Tree)" xdrBase64={result.returnValue} />
              ) : (
                <div style={{ color: "var(--muted)", fontStyle: "italic", fontSize: "11px" }}>
                  No return value yet. Run a simulation to inspect output.
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Inspect Custom XDR (with Raw Fallback)</div>
              <textarea
                placeholder="Paste raw Base64 XDR string to inspect tree..."
                value={customXdrInput}
                onChange={(e) => setCustomXdrInput(e.target.value)}
                rows={2}
                style={{
                  width: "100%",
                  fontFamily: "monospace",
                  fontSize: "11px",
                  padding: "4px",
                  backgroundColor: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  boxSizing: "border-box",
                  marginBottom: "4px",
                }}
              />
              {customXdrInput && <XdrInspectorTree title="Custom XDR Payload" xdrBase64={customXdrInput} />}
            </div>
          </div>
        )}

        {activeTab === "checkpoints" && (
          <CheckpointManager
            sandboxId={sandboxId}
            files={files}
            onFilesReset={(newFiles) => {
              if (onResetFiles) onResetFiles(newFiles);
            }}
            currentContractId={contractId}
            currentFn={fn}
            currentArgs={args}
            onLoadScenario={(sc) => {
              setContractId(sc.contractId);
              setFn(sc.fn);
              setArgs(sc.args);
              setActiveTab("simulate");
            }}
          />
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

      // Create initial named checkpoint for non-destructive reset (#1098)
      createCheckpoint(sandboxId, "Initial Template State", `Initialized template: ${template.name}`, templateMap).catch((e) => {
        console.warn("Failed to create initial checkpoint:", e);
      });

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

  const handleResetFiles = async (newFiles: Map<string, SandboxFile>) => {
    setFiles(newFiles);
    if (webcontainerRef.current) {
      try {
        await mountFiles(webcontainerRef.current, newFiles);
      } catch (err) {
        console.warn("Failed to re-mount files in WebContainer:", err);
      }
    }
    const firstKey = Array.from(newFiles.keys())[0];
    if (firstKey) {
      setSelectedFile(firstKey);
    }
    setTerminalOutput((prev) => [...prev, "> Environment restored from checkpoint."]);
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

      <ActionBar
        files={files}
        sandboxId={sandboxId}
        onSaveCheckpoint={() => {
          createCheckpoint(sandboxId, `Checkpoint ${new Date().toLocaleTimeString()}`, "Manual checkpoint", files)
            .then(() => setTerminalOutput((prev) => [...prev, "> Checkpoint saved."]))
            .catch(() => {});
        }}
      />

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
          <SimulationPanel sandboxId={sandboxId} files={files} onResetFiles={handleResetFiles} />
          <Terminal output={terminalOutput} />
        </div>
      </div>
    </div>
  );
};

export default Sandbox;
