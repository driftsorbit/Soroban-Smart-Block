// ABI metadata lint (issue #1054).
//
// Pure checks that run before an ABI is submitted: function and parameter
// naming, duplicate definitions, parameter kinds, and size limits. No network
// or database access, so the same rules can run in the API and in tests.

export const LIMITS = Object.freeze({
  maxFunctions: 256,
  maxParamsPerFunction: 32,
  maxSymbolLength: 32,
  maxDescriptionLength: 500,
});

// Soroban Symbol rules: 1–32 characters from [A-Za-z0-9_].
const SYMBOL_RE = /^[A-Za-z0-9_]{1,32}$/;

// Primitive and container kinds the decoder understands. Anything else is
// reported as a warning rather than an error, since user-defined structs and
// enums are legal parameter kinds.
const KNOWN_KINDS = new Set([
  "address", "bool", "bytes", "bytesn", "duration", "i32", "i64", "i128", "i256",
  "map", "option", "string", "symbol", "timepoint", "tuple", "u32", "u64", "u128",
  "u256", "vec", "void",
]);

function issue(path, code, message) {
  return { path, code, message };
}

function lintDescription(description, path, errors) {
  if (description === undefined || description === null) return;
  if (typeof description !== "string") {
    errors.push(issue(path, "invalid_description", "description must be a string"));
  } else if (description.length > LIMITS.maxDescriptionLength) {
    errors.push(issue(path, "description_too_long", `description exceeds ${LIMITS.maxDescriptionLength} characters`));
  }
}

function lintParams(params, fnPath, errors, warnings) {
  if (params === undefined) return;
  if (!Array.isArray(params)) {
    errors.push(issue(`${fnPath}/params`, "invalid_params", "params must be an array"));
    return;
  }
  if (params.length > LIMITS.maxParamsPerFunction) {
    errors.push(issue(`${fnPath}/params`, "too_many_params", `a function may have at most ${LIMITS.maxParamsPerFunction} parameters`));
  }

  const seen = new Set();
  params.forEach((param, i) => {
    const path = `${fnPath}/params/${i}`;
    if (!param || typeof param !== "object") {
      errors.push(issue(path, "invalid_param", "parameter must be an object"));
      return;
    }
    if (typeof param.name !== "string" || !SYMBOL_RE.test(param.name)) {
      errors.push(issue(`${path}/name`, "invalid_param_name", "parameter name must be a 1–32 character identifier"));
    } else if (seen.has(param.name)) {
      errors.push(issue(`${path}/name`, "duplicate_param", `parameter "${param.name}" is defined more than once`));
    } else {
      seen.add(param.name);
    }

    if (typeof param.kind !== "string" || param.kind.trim() === "") {
      errors.push(issue(`${path}/kind`, "missing_param_kind", "parameter kind must be a non-empty string"));
    } else if (!KNOWN_KINDS.has(param.kind.toLowerCase())) {
      warnings.push(issue(`${path}/kind`, "unknown_param_kind", `"${param.kind}" is not a built-in type; treated as a user-defined type`));
    }
  });
}

/**
 * Lint an ABI function list.
 *
 * @param {unknown} functions - Expected: FunctionAbi[] ({ name, description?, params? }).
 * @returns {{ valid: boolean, errors: Array<{path,code,message}>, warnings: Array<{path,code,message}> }}
 */
export function lintAbi(functions) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(functions)) {
    errors.push(issue("/functions", "invalid_functions", "functions must be an array"));
    return { valid: false, errors, warnings };
  }
  if (functions.length === 0) {
    warnings.push(issue("/functions", "no_functions", "ABI declares no functions"));
  }
  if (functions.length > LIMITS.maxFunctions) {
    errors.push(issue("/functions", "too_many_functions", `an ABI may declare at most ${LIMITS.maxFunctions} functions`));
  }

  const seen = new Set();
  functions.forEach((fn, i) => {
    const fnPath = `/functions/${i}`;
    if (!fn || typeof fn !== "object") {
      errors.push(issue(fnPath, "invalid_function", "function must be an object"));
      return;
    }

    if (typeof fn.name !== "string" || !SYMBOL_RE.test(fn.name)) {
      errors.push(issue(`${fnPath}/name`, "invalid_function_name", "function name must be a 1–32 character identifier"));
    } else if (seen.has(fn.name)) {
      errors.push(issue(`${fnPath}/name`, "duplicate_function", `function "${fn.name}" is defined more than once`));
    } else {
      seen.add(fn.name);
    }

    lintDescription(fn.description, `${fnPath}/description`, errors);
    lintParams(fn.params ?? fn.args, fnPath, errors, warnings);
  });

  return { valid: errors.length === 0, errors, warnings };
}
