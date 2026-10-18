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

export interface SimulationResult {
  mode: "remote" | "local";
  returnValue?: string;
  error?: string;
  events: string[];
  cpuInsns: number;
  memBytes: number;
  stateDiff: { key: string; before: string | null; after: string | null }[];
  warnings: string[];
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

export async function simulateRemote(contractId: string, fn: string, args: xdr.ScVal[]): Promise<SimulationResult> {
  const sim = await simulateViaRpc(contractId, fn, args);
  return {
    mode: "remote",
    returnValue: sim.returnValue,
    error: sim.success ? undefined : sim.error,
    events: sim.events ?? [],
    cpuInsns: Number(sim.cost?.cpuInsns ?? 0),
    memBytes: Number(sim.cost?.memBytes ?? 0),
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

  async simulate(contractId: string, fn: string, args: xdr.ScVal[]): Promise<SimulationResult> {
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
    return {
      mode: "local",
      returnValue: out.result ?? undefined,
      error: out.error ?? undefined,
      events: out.events,
      cpuInsns: out.budget.cpuInsns,
      memBytes: out.budget.memBytes,
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

// ── Replay, Protocol Comparison, Scenario Collections, and Auth Validation (#1090-#1093) ──

export interface ContractCallScenario {
  id?: string;
  name?: string;
  description?: string;
  contractId: string;
  fn: string;
  args: any[] | string;
  auth?: string[];
  env?: {
    protocolVersion?: number;
    sequence?: number;
    timestamp?: number;
    networkPassphrase?: string;
    ledgerEntries?: any[];
  };
  baselineResult?: {
    returnValue?: string;
    error?: string;
    cost?: { cpuInsns: number; memBytes: number };
    events?: string[];
  } | null;
}

export interface ReplayResult {
  success: boolean;
  scenarioId?: string;
  scenarioName?: string;
  isDeterministic: boolean;
  isLedgerDependent: boolean;
  ledgerDependencies: string[];
  warning?: string | null;
  replayResult: {
    success: boolean;
    returnValue?: string;
    error?: string;
    cost: { cpuInsns: number; memBytes: number };
    events: string[];
  };
  comparison?: {
    matched: boolean;
    returnValueMatch: boolean;
    errorMatch: boolean;
    costDelta: { cpuInsns: number; memBytes: number };
  } | null;
  environmentAssumptions?: Record<string, any>;
}

export interface ProtocolComparisonResult {
  success: boolean;
  contractId: string;
  fn: string;
  supportedProtocols: number[];
  comparisons: Array<{
    protocol: number;
    label: string;
    environment: {
      protocol: number;
      network: string;
      status: string;
      wasmSpec?: string;
      hostFeatures?: string[];
    };
    success: boolean;
    returnValue?: string;
    cost: { cpuInsns: number; memBytes: number };
    minResourceFee: number;
    events: string[];
    error?: string;
  }>;
  deltas: Array<{
    baselineProtocol: number;
    comparedProtocol: number;
    cpuDelta: number;
    cpuPercentChange: number;
    memDelta: number;
    memPercentChange: number;
    returnValueMatch: boolean;
    errorMatch: boolean;
  }>;
  summary: string;
}

export interface ScenarioCollection {
  id: string;
  name: string;
  description: string;
  scenarios: ContractCallScenario[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthValidationResult {
  valid: boolean;
  contractId: string;
  function: string;
  requiredEntries: Array<{
    signer: string;
    scope: string;
    reason: string;
    status: "present" | "missing" | "malformed";
  }>;
  missing: Array<{
    signer: string;
    scope: string;
    reason: string;
  }>;
  malformed: Array<{
    index?: number;
    field?: string;
    entry?: any;
    error: string;
  }>;
  providedEntries: Array<{
    signer: string;
    credentialType: string;
    scopes: string[];
  }>;
  explanation: string;
}

export async function replayScenario(scenario: ContractCallScenario): Promise<ReplayResult> {
  const res = await fetch(`${API_BASE}/api/sandbox/replay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Replay failed: ${res.statusText}`);
  }
  return res.json();
}

export async function compareProtocols(
  contractId: string,
  fn: string,
  args: any[] = [],
  protocols?: number[],
  env?: Record<string, any>,
): Promise<ProtocolComparisonResult> {
  const res = await fetch(`${API_BASE}/api/sandbox/compare-protocols`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contractId, fn, args, protocols, env }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Protocol comparison failed: ${res.statusText}`);
  }
  return res.json();
}

export async function listCollections(
  limit: number = 50,
  offset: number = 0,
): Promise<{
  collections: Array<{
    id: string;
    name: string;
    description: string;
    scenarioCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}> {
  const res = await fetch(`${API_BASE}/api/sandbox/collections?limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error(`Failed to list scenario collections: ${res.statusText}`);
  return res.json();
}

export async function getCollection(id: string): Promise<ScenarioCollection> {
  const res = await fetch(`${API_BASE}/api/sandbox/collections/${id}`);
  if (!res.ok) throw new Error(`Failed to get scenario collection: ${res.statusText}`);
  return res.json();
}

export async function saveCollection(
  collection: Partial<ScenarioCollection>,
): Promise<{ collection: ScenarioCollection; strippedSecretsCount: number }> {
  const res = await fetch(`${API_BASE}/api/sandbox/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collection),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to save scenario collection: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteCollection(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sandbox/collections/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete scenario collection: ${res.statusText}`);
}

export async function exportCollection(collectionIdOrData: string | Partial<ScenarioCollection>): Promise<{
  version: number;
  exportedAt: string;
  schema: string;
  collection: ScenarioCollection;
  strippedSecretsCount: number;
}> {
  const payload =
    typeof collectionIdOrData === "string" ? { collectionId: collectionIdOrData } : { collection: collectionIdOrData };
  const res = await fetch(`${API_BASE}/api/sandbox/collections/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to export scenario collection: ${res.statusText}`);
  }
  return res.json();
}

export async function importCollection(data: string | Record<string, any>): Promise<{
  success: boolean;
  collection: ScenarioCollection;
  strippedSecretsCount: number;
}> {
  const res = await fetch(`${API_BASE}/api/sandbox/collections/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof data === "string" ? data : JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to import scenario collection: ${res.statusText}`);
  }
  return res.json();
}

export async function validateSimulationAuth(
  contractId: string,
  fn: string,
  args: any[] = [],
  auth: string[] = [],
  sourceAccount?: string,
): Promise<AuthValidationResult> {
  const res = await fetch(`${API_BASE}/api/sandbox/validate-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contractId, fn, args, auth, sourceAccount }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Auth validation request failed: ${res.statusText}`);
  }
  return res.json();
}
