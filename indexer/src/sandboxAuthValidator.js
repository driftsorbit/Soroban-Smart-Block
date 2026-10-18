import { StrKey, xdr } from "@stellar/stellar-sdk";

/**
 * Validates whether a string is a valid Stellar Contract ID (C...)
 */
export function isValidContractId(id) {
  if (typeof id !== "string") return false;
  try {
    return id.startsWith("C") && id.length === 56 && StrKey.isValidContract(id);
  } catch {
    return false;
  }
}

/**
 * Validates whether a string is a valid Stellar Account ID (G...)
 */
export function isValidAccountId(id) {
  if (typeof id !== "string") return false;
  try {
    return id.startsWith("G") && id.length === 56 && StrKey.isValidEd25519PublicKey(id);
  } catch {
    return false;
  }
}

/**
 * Known read-only functions that do not require any authorization entries.
 */
const READ_ONLY_FUNCTION_PREFIXES = ["get", "read", "is", "has", "query", "check", "fetch"];
const READ_ONLY_EXACT_FUNCTIONS = new Set([
  "balance",
  "decimals",
  "name",
  "symbol",
  "allowance",
  "total_supply",
  "totalsupply",
  "version",
  "admin",
]);

/**
 * Parse a single SorobanAuthorizationEntry from XDR base64 or object.
 */
export function parseAuthEntry(entry) {
  if (!entry) throw new Error("Empty authorization entry");

  let authEntry;
  if (typeof entry === "string") {
    authEntry = xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64");
  } else if (entry instanceof xdr.SorobanAuthorizationEntry) {
    authEntry = entry;
  } else {
    throw new Error("Authorization entry must be a base64 XDR string");
  }

  // Extract credentials signer
  const creds = authEntry.credentials();
  let signer = "unknown";
  let credentialType = creds.switch().name;

  if (creds.switch().name === "sorobanCredentialsSourceAccount") {
    signer = "source_account";
  } else if (creds.address()) {
    const scAddr = creds.address().address();
    if (scAddr.switch().name === "scAddressTypeAccount") {
      signer = StrKey.encodeEd25519PublicKey(scAddr.accountId().ed25519());
    } else if (scAddr.switch().name === "scAddressTypeContract") {
      signer = StrKey.encodeContract(scAddr.contractId());
    }
  }

  // Extract root invocation scope
  const scopes = [];
  function walk(inv) {
    const fn = inv.function();
    if (fn.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
      const cf = fn.contractFn();
      const cId = StrKey.encodeContract(cf.contractAddress().contractId());
      const fName = cf.functionName().toString();
      scopes.push(`${cId}:${fName}`);
    } else {
      scopes.push("CREATE_CONTRACT");
    }
    for (const sub of inv.subInvocations()) {
      walk(sub);
    }
  }

  walk(authEntry.rootInvocation());

  return {
    signer,
    credentialType,
    scopes,
  };
}

/**
 * Deduce required authorizations for a contract call based on function name and arguments.
 */
export function deduceRequiredAuthorizations(contractId, fn, args = [], sourceAccount = null) {
  const normalizedFn = fn.toLowerCase();

  // Read-only functions
  if (
    READ_ONLY_EXACT_FUNCTIONS.has(normalizedFn) ||
    READ_ONLY_FUNCTION_PREFIXES.some(
      (prefix) =>
        normalizedFn.startsWith(prefix) &&
        (normalizedFn.length === prefix.length ||
          normalizedFn[prefix.length] === "_" ||
          normalizedFn[prefix.length] === "-"),
    )
  ) {
    return [];
  }

  const parsedArgs = Array.isArray(args)
    ? args
    : typeof args === "string" && args.trim().startsWith("[")
      ? JSON.parse(args)
      : [];

  const required = [];

  // Common SEP-41 Token Patterns
  if (normalizedFn === "transfer" && parsedArgs.length >= 1) {
    const fromAddr = String(parsedArgs[0]);
    if (isValidAccountId(fromAddr) || isValidContractId(fromAddr)) {
      required.push({
        signer: fromAddr,
        scope: `${contractId}:${fn}`,
        reason: `Address '${fromAddr}' (from) must authorize token transfer debit`,
      });
    }
  } else if (normalizedFn === "transfer_from" && parsedArgs.length >= 1) {
    const spenderAddr = String(parsedArgs[0]);
    if (isValidAccountId(spenderAddr) || isValidContractId(spenderAddr)) {
      required.push({
        signer: spenderAddr,
        scope: `${contractId}:${fn}`,
        reason: `Address '${spenderAddr}' (spender) must authorize transfer_from invocation`,
      });
    }
  } else if (normalizedFn === "approve" && parsedArgs.length >= 1) {
    const fromAddr = String(parsedArgs[0]);
    if (isValidAccountId(fromAddr) || isValidContractId(fromAddr)) {
      required.push({
        signer: fromAddr,
        scope: `${contractId}:${fn}`,
        reason: `Address '${fromAddr}' (owner) must authorize setting allowance`,
      });
    }
  } else if (normalizedFn === "burn" && parsedArgs.length >= 1) {
    const fromAddr = String(parsedArgs[0]);
    if (isValidAccountId(fromAddr) || isValidContractId(fromAddr)) {
      required.push({
        signer: fromAddr,
        scope: `${contractId}:${fn}`,
        reason: `Address '${fromAddr}' must authorize burning tokens`,
      });
    }
  } else if (normalizedFn === "burn_from" && parsedArgs.length >= 1) {
    const spenderAddr = String(parsedArgs[0]);
    if (isValidAccountId(spenderAddr) || isValidContractId(spenderAddr)) {
      required.push({
        signer: spenderAddr,
        scope: `${contractId}:${fn}`,
        reason: `Address '${spenderAddr}' (spender) must authorize burning tokens`,
      });
    }
  } else if (normalizedFn === "mint" || normalizedFn === "set_admin") {
    const adminSigner = sourceAccount || "admin";
    required.push({
      signer: adminSigner,
      scope: `${contractId}:${fn}`,
      reason: `Contract administrator or caller must authorize privileged operation '${fn}'`,
    });
  } else {
    // Generic mutating call heuristics: if first argument is a Stellar Address, it typically requires auth
    if (parsedArgs.length > 0) {
      const firstArg = String(parsedArgs[0]);
      if (isValidAccountId(firstArg) || isValidContractId(firstArg)) {
        required.push({
          signer: firstArg,
          scope: `${contractId}:${fn}`,
          reason: `Signer '${firstArg}' must authorize invocation of '${fn}'`,
        });
      }
    }
  }

  return required;
}

/**
 * Validate authorization requirements before simulation.
 * Explains required authorization entries, detects missing or malformed inputs.
 */
export function validateAuthRequirements({ contractId, fn, args = [], auth = [], sourceAccount = null } = {}) {
  // Input validation
  const errors = [];
  const malformed = [];

  if (!contractId || typeof contractId !== "string" || !contractId.trim()) {
    errors.push("contractId is required");
  } else if (!isValidContractId(contractId.trim())) {
    malformed.push({
      field: "contractId",
      value: contractId,
      error: "contractId must be a valid 56-character Stellar contract address starting with 'C'",
    });
  }

  if (!fn || typeof fn !== "string" || !fn.trim()) {
    errors.push("fn (function name) is required");
  }

  if (sourceAccount) {
    if (typeof sourceAccount !== "string" || !isValidAccountId(sourceAccount.trim())) {
      malformed.push({
        field: "sourceAccount",
        value: sourceAccount,
        error: "sourceAccount must be a valid 56-character Stellar account address starting with 'G'",
      });
    }
  }

  let parsedArgs = [];
  if (args !== undefined && args !== null) {
    if (Array.isArray(args)) {
      parsedArgs = args;
    } else if (typeof args === "string") {
      try {
        parsedArgs = args.trim() ? JSON.parse(args) : [];
        if (!Array.isArray(parsedArgs)) {
          malformed.push({
            field: "args",
            value: args,
            error: "args must be a JSON array",
          });
        }
      } catch {
        malformed.push({
          field: "args",
          value: args,
          error: "args must be a valid JSON array or JS array",
        });
      }
    } else {
      malformed.push({
        field: "args",
        value: args,
        error: "args must be an array",
      });
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  // Parse provided auth entries
  const authList = Array.isArray(auth) ? auth : [];
  const providedEntries = [];

  authList.forEach((entry, idx) => {
    try {
      const parsed = parseAuthEntry(entry);
      providedEntries.push(parsed);
    } catch (err) {
      malformed.push({
        index: idx,
        entry,
        error: `Malformed authorization entry: ${err.message}`,
      });
    }
  });

  // Deduce required entries
  const required = deduceRequiredAuthorizations(contractId, fn, parsedArgs, sourceAccount);

  // Match required against provided
  const requiredEntries = [];
  const missing = [];

  for (const req of required) {
    const isProvided = providedEntries.some((p) => {
      const signerMatch = p.signer === req.signer || (p.signer === "source_account" && sourceAccount === req.signer);
      const scopeMatch = p.scopes.includes(req.scope) || p.scopes.includes("CREATE_CONTRACT");
      return signerMatch && scopeMatch;
    });

    if (isProvided) {
      requiredEntries.push({
        ...req,
        status: "present",
      });
    } else {
      requiredEntries.push({
        ...req,
        status: "missing",
      });
      missing.push({
        signer: req.signer,
        scope: req.scope,
        reason: req.reason,
      });
    }
  }

  const valid = missing.length === 0 && malformed.length === 0;

  // Build human-readable explanation
  let explanation = "";
  if (valid) {
    if (required.length === 0) {
      explanation = `Function '${fn}' does not require authorization entries (read-only or non-authenticated call). Ready to simulate.`;
    } else {
      explanation = `All ${required.length} required authorization entries are present and well-formed. Ready to simulate.`;
    }
  } else {
    const reasons = [];
    if (missing.length > 0) {
      reasons.push(
        `Missing ${missing.length} required authorization entry(ies): ${missing.map((m) => `${m.signer} for ${m.scope}`).join(", ")}`,
      );
    }
    if (malformed.length > 0) {
      reasons.push(`${malformed.length} malformed input(s) detected`);
    }
    explanation = reasons.join(". ") + ".";
  }

  return {
    valid,
    contractId,
    function: fn,
    requiredEntries,
    missing,
    malformed,
    providedEntries,
    explanation,
  };
}
