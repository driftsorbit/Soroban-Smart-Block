import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { SandboxFile } from "./webcontainer";

// ImportMetaEnv (including VITE_API_URL) is declared globally in src/env.d.ts.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
const DEFAULT_RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
type SorobanReadMethod = "simulateTransaction" | "getLedgerEntries" | "getLatestLedger" | "getNetwork" | "getEvents";

export async function sorobanRpcRequest<T>(
  rpcUrl: string,
  method: SorobanReadMethod,
  params: Record<string, unknown> = {},
): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  let proxyError = "";

  if (rpcUrl === DEFAULT_RPC_URL) {
    try {
      const response = await fetch(`${API_BASE}/api/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? `RPC proxy returned ${response.status}`);
      }
      return payload.result as T;
    } catch (error) {
      proxyError = (error as Error).message;
    }
  }

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? `RPC returned ${response.status}`);
    }
    return payload.result as T;
  } catch (error) {
    const directError = (error as Error).message;
    throw new Error(proxyError ? `RPC proxy failed (${proxyError}); direct RPC failed (${directError})` : directError);
  }
}

export interface SavedSandbox {
  sandboxId: string;
  templateId: string;
  files: Record<string, SandboxFile>;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export async function saveSandbox(
  sandboxId: string,
  templateId: string,
  files: Map<string, SandboxFile>,
  metadata?: Record<string, any>,
): Promise<void> {
  const filesObj: Record<string, SandboxFile> = {};
  for (const [key, file] of files) {
    filesObj[key] = file;
  }

  const response = await fetch(`${API_BASE}/api/sandbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sandboxId,
      templateId,
      files: filesObj,
      metadata,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save sandbox: ${response.statusText}`);
  }
}

export async function loadSandbox(sandboxId: string): Promise<SavedSandbox> {
  const response = await fetch(`${API_BASE}/api/sandbox/${sandboxId}`);

  if (!response.ok) {
    throw new Error(`Failed to load sandbox: ${response.statusText}`);
  }

  return response.json();
}

export async function listSandboxes(
  limit: number = 20,
  offset: number = 0,
): Promise<{
  sandboxes: Omit<SavedSandbox, "files">[];
  total: number;
}> {
  const response = await fetch(`${API_BASE}/api/sandboxes?limit=${limit}&offset=${offset}`);

  if (!response.ok) {
    throw new Error(`Failed to list sandboxes: ${response.statusText}`);
  }

  return response.json();
}

export async function deleteSandbox(sandboxId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sandbox/${sandboxId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Failed to delete sandbox: ${response.statusText}`);
  }
}

// ── Contract simulation: remote (RPC proxy) or local in-browser host (#925) ──

const NETWORK_PASSPHRASE = import.meta.env.VITE_STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const LOCAL_STATE_KEY = "soroban_sandbox_local_state";

export interface LedgerIO {
  readBytes: number;
  writeBytes: number;
  readEntries: number;
  writeEntries: number;
}

export interface ResourceBudget {
  cpuInsns: number;
  memBytes: number;
  ledgerIO?: LedgerIO | null;
  minResourceFee?: string | null;
  ledgerIOUnavailable?: boolean;
  feeUnavailable?: boolean;
}

export interface BudgetDelta {
  diff: number | null;
  percent: number | null;
  status: "increased" | "decreased" | "unchanged" | "baseline" | "unavailable";
}

export interface SimulationBudgetDeltas {
  cpu: BudgetDelta;
  mem: BudgetDelta;
  ledgerReadBytes: BudgetDelta;
  ledgerWriteBytes: BudgetDelta;
  ledgerEntries: BudgetDelta;
  fee: BudgetDelta;
}

export interface SandboxCheckpoint {
  id: string;
  name: string;
  createdAt: string;
  files: Record<string, SandboxFile>;
  description?: string;
}

export interface SandboxScenario {
  id: string;
  name: string;
  contractId: string;
  fn: string;
  args: string;
  description?: string;
  createdAt: string;
}

export interface SimulationResult {
  mode: "remote" | "local";
  returnValue?: string;
  error?: string;
  events: string[];
  cpuInsns: number;
  memBytes: number;
  ledgerIO?: LedgerIO | null;
  minResourceFee?: string | null;
  ledgerIOUnavailable?: boolean;
  feeUnavailable?: boolean;
  budgetDeltas?: SimulationBudgetDeltas;
  stateDiff: { key: string; before: string | null; after: string | null }[];
  warnings: string[];
}

export function calculateBudgetDeltas(
  current: ResourceBudget,
  previous: ResourceBudget | null,
): SimulationBudgetDeltas {
  function getDelta(currVal: number | null | undefined, prevVal: number | null | undefined, isUnavailable: boolean): BudgetDelta {
    if (isUnavailable || currVal === null || currVal === undefined) {
      return { diff: null, percent: null, status: "unavailable" };
    }
    if (!previous || prevVal === null || prevVal === undefined) {
      return { diff: 0, percent: 0, status: "baseline" };
    }
    const diff = currVal - prevVal;
    const percent = prevVal > 0 ? (diff / prevVal) * 100 : (diff === 0 ? 0 : 100);
    const status = diff > 0 ? "increased" : diff < 0 ? "decreased" : "unchanged";
    return { diff, percent, status };
  }

  const feeCurr = current.minResourceFee != null ? Number(current.minResourceFee) : null;
  const feePrev = previous?.minResourceFee != null ? Number(previous.minResourceFee) : null;

  return {
    cpu: getDelta(current.cpuInsns, previous?.cpuInsns, false),
    mem: getDelta(current.memBytes, previous?.memBytes, false),
    ledgerReadBytes: getDelta(current.ledgerIO?.readBytes, previous?.ledgerIO?.readBytes, !!current.ledgerIOUnavailable),
    ledgerWriteBytes: getDelta(current.ledgerIO?.writeBytes, previous?.ledgerIO?.writeBytes, !!current.ledgerIOUnavailable),
    ledgerEntries: getDelta(
      current.ledgerIO ? current.ledgerIO.readEntries + current.ledgerIO.writeEntries : null,
      previous?.ledgerIO ? previous.ledgerIO.readEntries + previous.ledgerIO.writeEntries : null,
      !!current.ledgerIOUnavailable
    ),
    fee: getDelta(feeCurr, feePrev, !!current.feeUnavailable),
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type HostRequest =
  | { id: number; op: "init" }
  | { id: number; op: "setLedgerInfo"; protocol: number; sequence: number; timestamp: number; passphrase: string }
  | { id: number; op: "setEntries"; entries: ImportedEntry[] }
  | { id: number; op: "invoke"; hostFn: string; diagnostics: boolean };

interface ImportedEntry {
  key: string;
  entry: string;
  liveUntilLedgerSeq: number | null;
}

interface LocalState {
  entries: ImportedEntry[];
  protocolVersion: number;
  latestLedger: number;
}

/** Parse a JSON array of native JS values into ScVal arguments. */
export function parseArgs(json: string): xdr.ScVal[] {
  const values = json.trim() ? JSON.parse(json) : [];
  if (!Array.isArray(values)) throw new Error("Arguments must be a JSON array");
  return values.map((v) =>
    typeof v === "string" && /^[GC][A-Z2-7]{55}$/.test(v) ? new Address(v).toScVal() : nativeToScVal(v),
  );
}

function invokeHostFunction(contractId: string, fn: string, args: xdr.ScVal[]): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({ contractAddress: new Address(contractId).toScAddress(), functionName: fn, args }),
  );
}

async function simulateViaRpc(contractId: string, fn: string, args: xdr.ScVal[]) {
  const source = new Account(Keypair.random().publicKey(), "0");
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract: contractId, function: fn, args }))
    .setTimeout(30)
    .build();
  const res = await fetch(`${API_BASE}/api/sandbox/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xdrEnvelope: tx.toEnvelope().toXDR("base64") }),
  });
  if (!res.ok) throw new Error(`Simulation failed: ${res.statusText}`);
  return res.json();
}

export async function simulateRemote(
  contractId: string,
  fn: string,
  args: xdr.ScVal[],
  previousBudget: ResourceBudget | null = null,
): Promise<SimulationResult> {
  const sim = await simulateViaRpc(contractId, fn, args);
  const ledgerIO: LedgerIO | null = sim.ledgerIO ?? null;
  const minResourceFee: string | null = sim.minResourceFee ?? null;
  const ledgerIOUnavailable = !ledgerIO;
  const feeUnavailable = minResourceFee == null;

  const budget: ResourceBudget = {
    cpuInsns: Number(sim.cost?.cpuInsns ?? 0),
    memBytes: Number(sim.cost?.memBytes ?? 0),
    ledgerIO,
    minResourceFee,
    ledgerIOUnavailable,
    feeUnavailable,
  };

  const budgetDeltas = calculateBudgetDeltas(budget, previousBudget);

  return {
    mode: "remote",
    returnValue: sim.returnValue,
    error: sim.success ? undefined : sim.error,
    events: sim.events ?? [],
    cpuInsns: budget.cpuInsns,
    memBytes: budget.memBytes,
    ledgerIO,
    minResourceFee,
    ledgerIOUnavailable,
    feeUnavailable,
    budgetDeltas,
    stateDiff: [],
    warnings: [],
  };
}

/** Client for the in-browser Soroban host running in a Web Worker. */
export class LocalSandboxHost {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private protocolVersion: number | null = null;
  private networkProtocol: number | null = null;

  private call<T>(req: DistributiveOmit<HostRequest, "id">): Promise<T> {
    if (!this.worker) {
      // Lazy: the host WASM (~2 MB) is only fetched when local execution is used.
      this.worker = new Worker(new URL("./sandboxHost.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (ev) => {
        const p = this.pending.get(ev.data.id);
        if (!p) return;
        this.pending.delete(ev.data.id);
        if (ev.data.ok) p.resolve(ev.data.result);
        else p.reject(new Error(ev.data.error));
      };
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ ...req, id });
    });
  }

  /** Load the host and restore any previously imported state (works offline). */
  async init(): Promise<{ protocolVersion: number; entries: number }> {
    const info = await this.call<{ protocolVersion: number; entries: number }>({ op: "init" });
    this.protocolVersion = info.protocolVersion;
    const saved = readLocalState();
    if (saved && info.entries === 0) await this.load(saved);
    return info;
  }

  private async load(state: LocalState): Promise<void> {
    this.networkProtocol = state.protocolVersion;
    await this.call({
      op: "setLedgerInfo",
      protocol: state.protocolVersion,
      sequence: state.latestLedger,
      timestamp: Math.floor(Date.now() / 1000),
      passphrase: NETWORK_PASSPHRASE,
    });
    await this.call({ op: "setEntries", entries: state.entries });
  }

  /**
   * Import the network state an invocation needs. The footprint from one RPC
   * simulation lists every entry touched — including called contracts'
   * instances and WASM code — so dependencies are resolved automatically.
   */
  async importState(contractId: string, fn: string, args: xdr.ScVal[]): Promise<number> {
    const sim = await simulateViaRpc(contractId, fn, args);
    if (!sim.transactionData) throw new Error(sim.error || "Simulation returned no footprint");
    const footprint = xdr.SorobanTransactionData.fromXDR(sim.transactionData, "base64").resources().footprint();
    const keys = [...footprint.readOnly(), ...footprint.readWrite()].map((k) => k.toXDR("base64"));
    const res = await fetch(`${API_BASE}/api/sandbox/ledger-entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    });
    if (!res.ok) throw new Error(`Failed to import ledger entries: ${res.statusText}`);
    const data: LocalState = await res.json();
    const merged = mergeLocalState(data);
    await this.load(merged);
    return data.entries.length;
  }

  async simulate(
    contractId: string,
    fn: string,
    args: xdr.ScVal[],
    previousBudget: ResourceBudget | null = null,
  ): Promise<SimulationResult> {
    const out = await this.call<{
      result: string | null;
      error: string | null;
      events: string[];
      budget: { cpuInsns: number; memBytes: number };
      stateDiff: { key: string; before: string | null; after: string | null }[];
    }>({ op: "invoke", hostFn: invokeHostFunction(contractId, fn, args).toXDR("base64"), diagnostics: false });
    const warnings: string[] = [];
    if (
      this.protocolVersion !== null &&
      this.networkProtocol !== null &&
      this.protocolVersion !== this.networkProtocol
    ) {
      warnings.push(
        `Bundled host is protocol ${this.protocolVersion} but imported state is from protocol ${this.networkProtocol}; results may differ from the network.`,
      );
    }

    const budget: ResourceBudget = {
      cpuInsns: out.budget.cpuInsns,
      memBytes: out.budget.memBytes,
      ledgerIO: null,
      minResourceFee: null,
      ledgerIOUnavailable: true,
      feeUnavailable: true,
    };

    const budgetDeltas = calculateBudgetDeltas(budget, previousBudget);

    return {
      mode: "local",
      returnValue: out.result ?? undefined,
      error: out.error ?? undefined,
      events: out.events,
      cpuInsns: out.budget.cpuInsns,
      memBytes: out.budget.memBytes,
      ledgerIO: null,
      minResourceFee: null,
      ledgerIOUnavailable: true,
      feeUnavailable: true,
      budgetDeltas,
      stateDiff: out.stateDiff,
      warnings,
    };
  }
}

function readLocalState(): LocalState | null {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mergeLocalState(update: LocalState): LocalState {
  const byKey = new Map((readLocalState()?.entries ?? []).map((e) => [e.key, e]));
  for (const e of update.entries) byKey.set(e.key, e);
  const merged = { ...update, entries: [...byKey.values()] };
  try {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(merged));
  } catch {
    // quota exceeded — state still lives in the worker for this session
  }
  return merged;
}

// ── Sandbox Checkpoints & Scenarios (#1098) ──────────────────────────────────

export async function createCheckpoint(
  sandboxId: string,
  name: string,
  description?: string,
  files?: Map<string, SandboxFile>,
): Promise<SandboxCheckpoint> {
  const filesObj: Record<string, SandboxFile> = {};
  if (files) {
    for (const [key, file] of files) filesObj[key] = file;
  }

  try {
    const response = await fetch(`${API_BASE}/api/sandbox/${sandboxId}/checkpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, files: files ? filesObj : undefined }),
    });
    if (response.ok) {
      const data = await response.json();
      return data.checkpoint;
    }
  } catch {
    // offline fallback
  }

  const checkpoint: SandboxCheckpoint = {
    id: `chk_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    name: name.trim(),
    description: description?.trim() || "",
    createdAt: new Date().toISOString(),
    files: filesObj,
  };
  const key = `checkpoints_${sandboxId}`;
  const existing: SandboxCheckpoint[] = JSON.parse(localStorage.getItem(key) || "[]");
  existing.push(checkpoint);
  localStorage.setItem(key, JSON.stringify(existing));
  return checkpoint;
}

export async function listCheckpoints(
  sandboxId: string,
): Promise<{ checkpoints: SandboxCheckpoint[]; scenarios: SandboxScenario[] }> {
  try {
    const response = await fetch(`${API_BASE}/api/sandbox/${sandboxId}/checkpoints`);
    if (response.ok) {
      return response.json();
    }
  } catch {
    // offline fallback
  }

  const checkpointsKey = `checkpoints_${sandboxId}`;
  const scenariosKey = `scenarios_${sandboxId}`;
  return {
    checkpoints: JSON.parse(localStorage.getItem(checkpointsKey) || "[]"),
    scenarios: JSON.parse(localStorage.getItem(scenariosKey) || "[]"),
  };
}

export async function resetToCheckpoint(
  sandboxId: string,
  checkpointId: string,
): Promise<{ restoredFiles: Record<string, SandboxFile>; retainedScenariosCount: number }> {
  try {
    const response = await fetch(`${API_BASE}/api/sandbox/${sandboxId}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpointId, confirm: true }),
    });
    if (response.ok) {
      const data = await response.json();
      return { restoredFiles: data.files, retainedScenariosCount: data.retainedScenariosCount };
    }
  } catch {
    // offline fallback
  }

  const checkpointsKey = `checkpoints_${sandboxId}`;
  const scenariosKey = `scenarios_${sandboxId}`;
  const checkpoints: SandboxCheckpoint[] = JSON.parse(localStorage.getItem(checkpointsKey) || "[]");
  const scenarios: SandboxScenario[] = JSON.parse(localStorage.getItem(scenariosKey) || "[]");
  const target = checkpoints.find((c) => c.id === checkpointId || c.name === checkpointId);
  if (!target) throw new Error("Checkpoint not found");

  return {
    restoredFiles: target.files,
    retainedScenariosCount: scenarios.length,
  };
}

export async function saveScenario(
  sandboxId: string,
  scenario: Omit<SandboxScenario, "id" | "createdAt">,
): Promise<SandboxScenario> {
  try {
    const response = await fetch(`${API_BASE}/api/sandbox/${sandboxId}/scenarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scenario),
    });
    if (response.ok) {
      const data = await response.json();
      return data.scenario;
    }
  } catch {
    // offline fallback
  }

  const item: SandboxScenario = {
    ...scenario,
    id: `scen_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const key = `scenarios_${sandboxId}`;
  const existing: SandboxScenario[] = JSON.parse(localStorage.getItem(key) || "[]");
  existing.push(item);
  localStorage.setItem(key, JSON.stringify(existing));
  return item;
}

export async function listScenarios(sandboxId: string): Promise<SandboxScenario[]> {
  try {
    const response = await fetch(`${API_BASE}/api/sandbox/${sandboxId}/scenarios`);
    if (response.ok) {
      const data = await response.json();
      return data.scenarios ?? [];
    }
  } catch {
    // offline fallback
  }

  const key = `scenarios_${sandboxId}`;
  return JSON.parse(localStorage.getItem(key) || "[]");
}
