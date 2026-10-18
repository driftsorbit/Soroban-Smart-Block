import { isValidContractId } from "./sandboxAuthValidator.js";
import { simulateScenarioDeterministically } from "./sandboxReplay.js";

/**
 * Supported protocol definitions with clear environment labels and feature specifications.
 */
export const SUPPORTED_PROTOCOLS = {
  20: {
    protocol: 20,
    label: "Protocol 20 (Soroban Initial)",
    environment: {
      protocol: 20,
      network: "testnet",
      status: "supported",
      wasmSpec: "v1",
      hostFeatures: ["Basic Host Functions", "Classic Soroban VM", "Base Cost Model"],
    },
  },
  21: {
    protocol: 21,
    label: "Protocol 21 (Soroban Archival & Secp256r1)",
    environment: {
      protocol: 21,
      network: "testnet",
      status: "supported",
      wasmSpec: "v2",
      hostFeatures: ["Secp256r1 Verification", "State Archival v2", "Tiered Storage Cost"],
    },
  },
  22: {
    protocol: 22,
    label: "Protocol 22 (Soroban High-Performance)",
    environment: {
      protocol: 22,
      network: "testnet",
      status: "supported",
      wasmSpec: "v3",
      hostFeatures: ["Optimized WASM Dispatch", "Extended Compute Limits", "Reduced Memory Overhead"],
    },
  },
};

export const SUPPORTED_PROTOCOL_NUMBERS = Object.keys(SUPPORTED_PROTOCOLS).map(Number);

/**
 * Validate protocol version list.
 */
export function validateProtocols(protocols) {
  if (protocols === undefined || protocols === null) {
    return [...SUPPORTED_PROTOCOL_NUMBERS];
  }

  if (!Array.isArray(protocols)) {
    throw new Error("protocols must be an array of supported protocol versions (numbers)");
  }

  if (protocols.length === 0) {
    throw new Error("protocols array cannot be empty");
  }

  const normalized = [];
  for (const p of protocols) {
    const num = Number(p);
    if (!Number.isInteger(num)) {
      throw new Error(`Protocol version '${p}' must be an integer`);
    }
    if (!SUPPORTED_PROTOCOLS[num]) {
      throw new Error(
        `Unsupported protocol version: ${num}. Supported protocol versions are: ${SUPPORTED_PROTOCOL_NUMBERS.join(", ")}`,
      );
    }
    if (!normalized.includes(num)) {
      normalized.push(num);
    }
  }

  return normalized.sort((a, b) => a - b);
}

/**
 * Compare simulation results across multiple protocol versions.
 */
export async function compareProtocolSimulations(
  { contractId, fn, args = [], protocols = null, env = {} } = {},
  options = {},
) {
  // Validate contractId & fn
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
        if (!Array.isArray(parsedArgs)) throw new Error("args must be a JSON array");
      } catch (e) {
        throw new Error(`Invalid args: ${e.message}`);
      }
    } else {
      throw new Error("args must be an array or JSON string");
    }
  }

  const selectedProtocols = validateProtocols(protocols);
  const executor = options.executor || simulateScenarioDeterministically;

  const comparisons = [];

  for (const p of selectedProtocols) {
    const meta = SUPPORTED_PROTOCOLS[p];
    const scenario = {
      contractId: contractId.trim(),
      fn: fn.trim(),
      args: parsedArgs,
      env: {
        ...env,
        protocolVersion: p,
      },
    };

    const sim = await executor(scenario, scenario.env);

    comparisons.push({
      protocol: p,
      label: meta.label,
      environment: meta.environment,
      success: sim.success,
      returnValue: sim.returnValue,
      cost: {
        cpuInsns: sim.cost.cpuInsns,
        memBytes: sim.cost.memBytes,
      },
      minResourceFee: Math.round(sim.cost.cpuInsns * 0.025 + sim.cost.memBytes * 0.05),
      events: sim.events,
      error: sim.error,
    });
  }

  // Calculate deltas relative to baseline (first protocol in list)
  const baseline = comparisons[0];
  const deltas = [];

  for (let i = 1; i < comparisons.length; i++) {
    const current = comparisons[i];
    const cpuDiff = current.cost.cpuInsns - baseline.cost.cpuInsns;
    const memDiff = current.cost.memBytes - baseline.cost.memBytes;
    const cpuPercent = baseline.cost.cpuInsns > 0 ? Number(((cpuDiff / baseline.cost.cpuInsns) * 100).toFixed(2)) : 0;
    const memPercent = baseline.cost.memBytes > 0 ? Number(((memDiff / baseline.cost.memBytes) * 100).toFixed(2)) : 0;

    deltas.push({
      baselineProtocol: baseline.protocol,
      comparedProtocol: current.protocol,
      cpuDelta: cpuDiff,
      cpuPercentChange: cpuPercent,
      memDelta: memDiff,
      memPercentChange: memPercent,
      returnValueMatch: current.returnValue === baseline.returnValue,
      errorMatch: (current.error || null) === (baseline.error || null),
    });
  }

  // Summary
  let summary = `Compared simulation across protocols ${selectedProtocols.join(", ")}.`;
  if (deltas.length > 0) {
    const latestDelta = deltas[deltas.length - 1];
    summary += ` Under ${SUPPORTED_PROTOCOLS[latestDelta.comparedProtocol].label}, CPU usage changed by ${latestDelta.cpuPercentChange}% and memory by ${latestDelta.memPercentChange}% compared to ${SUPPORTED_PROTOCOLS[baseline.protocol].label}.`;
  }

  return {
    success: true,
    contractId: contractId.trim(),
    fn: fn.trim(),
    supportedProtocols: SUPPORTED_PROTOCOL_NUMBERS,
    comparisons,
    deltas,
    summary,
  };
}
