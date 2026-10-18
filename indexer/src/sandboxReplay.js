import crypto from "crypto";
import { isValidContractId } from "./sandboxAuthValidator.js";

/**
 * Common keywords indicating ledger state or time sensitivity.
 */
const TIME_SENSITIVE_PATTERNS = [
  /time/i,
  /deadline/i,
  /expire/i,
  /expiry/i,
  /ttl/i,
  /sequence/i,
  /ledger/i,
  /epoch/i,
  /vest/i,
  /lock/i,
  /delay/i,
  /now/i,
];

/**
 * Validate a scenario structure.
 */
export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== "object" || Object.keys(scenario).length === 0) {
    throw new Error("Scenario must be a non-empty object");
  }

  const { contractId, fn, args, env, baselineResult } = scenario;

  if (!contractId || typeof contractId !== "string" || !contractId.trim()) {
    throw new Error("contractId is required and must be a non-empty string");
  }

  if (!isValidContractId(contractId.trim())) {
    throw new Error("contractId must be a valid 56-character Stellar contract address starting with 'C'");
  }

  if (!fn || typeof fn !== "string" || !fn.trim()) {
    throw new Error("fn (function name) is required and must be a non-empty string");
  }

  let parsedArgs = [];
  if (args !== undefined && args !== null) {
    if (Array.isArray(args)) {
      parsedArgs = args;
    } else if (typeof args === "string") {
      try {
        parsedArgs = args.trim() ? JSON.parse(args) : [];
        if (!Array.isArray(parsedArgs)) {
          throw new Error("args must be a JSON array");
        }
      } catch (e) {
        throw new Error(`Invalid args: ${e.message}`);
      }
    } else {
      throw new Error("args must be an array or JSON string");
    }
  }

  const normalizedEnv = {
    protocolVersion: Number(env?.protocolVersion) || 20,
    sequence: Number(env?.sequence) || 100000,
    timestamp: Number(env?.timestamp) || Math.floor(Date.now() / 1000),
    networkPassphrase:
      typeof env?.networkPassphrase === "string" ? env.networkPassphrase : "Test SDF Network ; September 2015",
    ledgerEntries: Array.isArray(env?.ledgerEntries) ? env.ledgerEntries : [],
  };

  return {
    id: scenario.id || `scen_${crypto.randomBytes(6).toString("hex")}`,
    name: scenario.name || `${fn} on ${contractId.slice(0, 8)}...`,
    contractId: contractId.trim(),
    fn: fn.trim(),
    args: parsedArgs,
    auth: Array.isArray(scenario.auth) ? scenario.auth : [],
    env: normalizedEnv,
    baselineResult: baselineResult && typeof baselineResult === "object" ? baselineResult : null,
  };
}

/**
 * Deterministic local simulation engine for replay and cross-checking without live network dependency.
 */
export function simulateScenarioDeterministically(scenario, envOverride = {}) {
  const env = { ...scenario.env, ...envOverride };
  const { contractId, fn, args } = scenario;

  // Derive a deterministic pseudo-seed from contractId, fn, args, and protocol
  const seedString = `${contractId}:${fn}:${JSON.stringify(args)}:p${env.protocolVersion}`;
  const hash = crypto.createHash("sha256").update(seedString).digest("hex");
  const baseCostCpu = 10000 + (parseInt(hash.slice(0, 4), 16) % 15000);
  const baseCostMem = 2048 + (parseInt(hash.slice(4, 8), 16) % 4096);

  // Check if function or args depend on ledger time or sequence
  const isTimeOrSeqSensitive =
    TIME_SENSITIVE_PATTERNS.some((p) => p.test(fn)) ||
    args.some((a) => typeof a === "string" && TIME_SENSITIVE_PATTERNS.some((p) => p.test(a)));

  // If time sensitive, output or cost varies with sequence/timestamp
  let returnValue = Buffer.from(hash.slice(0, 8)).toString("base64");
  let cpuInsns = baseCostCpu;
  let memBytes = baseCostMem;
  let events = [`evt_${hash.slice(0, 6)}`];
  let error = null;

  if (isTimeOrSeqSensitive) {
    // Add ledger sequence and timestamp influence
    const timeInfluence = (env.timestamp % 1000) ^ (env.sequence % 500);
    cpuInsns += timeInfluence * 10;
    returnValue = Buffer.from(`${hash.slice(0, 6)}_${env.sequence}`).toString("base64");
  }

  // Adjust cost according to protocol version
  const protocolDiscount = env.protocolVersion >= 22 ? 0.9 : env.protocolVersion >= 21 ? 0.95 : 1.0;
  cpuInsns = Math.round(cpuInsns * protocolDiscount);
  memBytes = Math.round(memBytes * protocolDiscount);

  return {
    success: error === null,
    returnValue,
    error,
    cost: {
      cpuInsns,
      memBytes,
    },
    events,
    envUsed: env,
    isTimeOrSeqSensitive,
  };
}

/**
 * Replay a scenario, cross-verify determinism, and flag ledger-dependent results.
 */
export async function replayScenario(rawScenario, options = {}) {
  const scenario = validateScenario(rawScenario);
  const executor = options.executor || simulateScenarioDeterministically;

  // 1. Run with the saved environment assumptions
  const primaryRun = await executor(scenario, scenario.env);

  // 2. Run under perturbed environment (shifted ledger sequence and timestamp)
  // to detect ledger dependencies
  const perturbedEnv = {
    ...scenario.env,
    sequence: scenario.env.sequence + 500,
    timestamp: scenario.env.timestamp + 3600,
  };
  const perturbedRun = await executor(scenario, perturbedEnv);

  // Evaluate ledger-dependency
  const ledgerDependencies = [];
  let isLedgerDependent = false;

  if (primaryRun.returnValue !== perturbedRun.returnValue) {
    isLedgerDependent = true;
    ledgerDependencies.push("Return value changes when ledger sequence or timestamp changes");
  }
  if (
    primaryRun.cost.cpuInsns !== perturbedRun.cost.cpuInsns ||
    primaryRun.cost.memBytes !== perturbedRun.cost.memBytes
  ) {
    isLedgerDependent = true;
    ledgerDependencies.push("Resource consumption varies with ledger sequence or timestamp");
  }
  if (primaryRun.events.join(",") !== perturbedRun.events.join(",")) {
    isLedgerDependent = true;
    ledgerDependencies.push("Emitted events differ when executed at different ledger sequences");
  }
  if (primaryRun.isTimeOrSeqSensitive) {
    isLedgerDependent = true;
    ledgerDependencies.push("Function or parameters reference time, deadline, lockup, or sequence constraints");
  }

  // Evaluate determinism against baseline
  let isDeterministic = true;
  let comparison = null;

  if (scenario.baselineResult) {
    const baseline = scenario.baselineResult;
    const returnValMatch = baseline.returnValue === primaryRun.returnValue;
    const errorMatch = (baseline.error || null) === (primaryRun.error || null);
    const cpuDelta = primaryRun.cost.cpuInsns - (baseline.cost?.cpuInsns ?? primaryRun.cost.cpuInsns);
    const memDelta = primaryRun.cost.memBytes - (baseline.cost?.memBytes ?? primaryRun.cost.memBytes);

    isDeterministic = returnValMatch && errorMatch;
    comparison = {
      matched: isDeterministic,
      returnValueMatch: returnValMatch,
      errorMatch,
      costDelta: {
        cpuInsns: cpuDelta,
        memBytes: memDelta,
      },
    };
  }

  return {
    success: true,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    isDeterministic,
    isLedgerDependent,
    ledgerDependencies,
    warning: isLedgerDependent
      ? "Warning: Ledger-dependent results detected. Outputs and resource usage vary across different ledger sequences and timestamps."
      : null,
    replayResult: {
      success: primaryRun.success,
      returnValue: primaryRun.returnValue,
      error: primaryRun.error,
      cost: primaryRun.cost,
      events: primaryRun.events,
    },
    comparison,
    environmentAssumptions: scenario.env,
  };
}
