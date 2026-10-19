/**
 * Generated event-type helpers and typed decoders from ABI metadata (#1085).
 *
 * Generates typed decoders from contract ABI metadata while preserving raw XDR
 * access and retaining unknown fields.
 */

export interface ParamDef {
  name: string;
  kind: string;
  description?: string;
}

export interface FunctionAbi {
  name: string;
  description?: string;
  params: ParamDef[];
  return_type?: string;
}

export interface ContractMeta {
  name?: string;
  description?: string;
  version?: number;
  abi_version?: number;
  min_ledger?: number;
  functions: FunctionAbi[];
  registered_by?: string;
  [key: string]: unknown;
}

export interface RawEvent {
  contract_id?: string;
  function?: string;
  ledger?: number;
  tx_hash?: string;
  seq?: number;
  raw_topics?: (string | unknown)[];
  raw_data?: string | unknown;
  raw_xdr?: string;
  event_xdr?: string;
  description?: string;
  [key: string]: unknown;
}

export interface DecodedContractEvent<TArgs = Record<string, unknown>> {
  contract_id?: string;
  function: string;
  args: TArgs;
  abi_match: boolean;
  function_abi?: FunctionAbi;
  ledger?: number;
  tx_hash?: string;
  seq?: number;
  raw_topics?: (string | unknown)[];
  raw_data?: string | unknown;
  raw_xdr?: string;
  event_xdr?: string;
  description?: string;
  [key: string]: unknown;
}

export interface EventDecoder<TMap extends Record<string, any> = Record<string, any>> {
  /** Decodes a raw event into a typed event structure. */
  decode<K extends keyof TMap & string = string>(
    event: RawEvent
  ): DecodedContractEvent<K extends keyof TMap ? TMap[K] : Record<string, unknown>>;
  /** Returns list of functions supported by this decoder's ABI. */
  supportedFunctions: string[];
  /** Check if a function name is registered in this decoder. */
  hasFunction(name: string): boolean;
  /** Get the ABI definition for a specific function. */
  getFunctionAbi(name: string): FunctionAbi | undefined;
}

export interface GenerateTypesOptions {
  /** Name of the exported TypeScript namespace or type. Defaults to contract name or 'ContractEvents'. */
  typeName?: string;
  /** Whether to export an event map type. Default: true. */
  exportEventMap?: boolean;
}

/**
 * Extracts function name and positional values from a raw event.
 */
function extractEventValues(event: RawEvent): {
  fnName: string;
  values: unknown[];
} {
  let fnName = event.function ?? '';
  const topics = Array.isArray(event.raw_topics) ? event.raw_topics : [];
  let positionalTopics: unknown[] = [];

  if (topics.length > 0) {
    const first = topics[0];
    const firstStr = typeof first === 'string' ? first : String(first ?? '');
    if (!fnName || fnName === 'unknown') {
      fnName = firstStr;
      positionalTopics = topics.slice(1);
    } else if (firstStr.toLowerCase() === fnName.toLowerCase()) {
      positionalTopics = topics.slice(1);
    } else {
      positionalTopics = topics;
    }
  }

  const values = [...positionalTopics];
  if (event.raw_data !== undefined && event.raw_data !== null && event.raw_data !== '') {
    // If raw_data is a JSON string of arguments or array
    if (typeof event.raw_data === 'string') {
      const trimmed = event.raw_data.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            values.push(...parsed);
          } else {
            values.push(parsed);
          }
        } catch {
          values.push(event.raw_data);
        }
      } else {
        values.push(event.raw_data);
      }
    } else if (Array.isArray(event.raw_data)) {
      values.push(...event.raw_data);
    } else {
      values.push(event.raw_data);
    }
  }

  return { fnName: fnName || 'unknown', values };
}

/**
 * Normalizes ABI functions into a lookup Map.
 */
function normalizeAbiFunctions(abi: ContractMeta | FunctionAbi[] | Record<string, FunctionAbi>): Map<string, FunctionAbi> {
  const map = new Map<string, FunctionAbi>();
  if (!abi) return map;

  let list: FunctionAbi[] = [];
  if (Array.isArray(abi)) {
    list = abi;
  } else if ('functions' in abi && Array.isArray(abi.functions)) {
    list = abi.functions;
  } else if (typeof abi === 'object') {
    list = Object.values(abi) as FunctionAbi[];
  }

  for (const fn of list) {
    if (fn && fn.name) {
      map.set(fn.name, fn);
      map.set(fn.name.toLowerCase(), fn);
    }
  }

  return map;
}

/**
 * Decodes a raw event using contract ABI metadata while retaining raw XDR access
 * and any unknown fields.
 *
 * @param event Raw event from explorer API, WebSocket, or Soroban RPC
 * @param abi Contract ABI metadata
 */
export function decodeEventWithAbi<TArgs = Record<string, unknown>>(
  event: RawEvent,
  abi: ContractMeta | FunctionAbi[] | Record<string, FunctionAbi>
): DecodedContractEvent<TArgs> {
  if (!event || typeof event !== 'object') {
    throw new TypeError('Expected event to be an object');
  }

  const abiMap = normalizeAbiFunctions(abi);
  const { fnName, values } = extractEventValues(event);
  const fnAbi = abiMap.get(fnName) || abiMap.get(fnName.toLowerCase());

  const args: Record<string, unknown> = {};

  if (fnAbi && Array.isArray(fnAbi.params)) {
    // Map known positional params
    for (let i = 0; i < fnAbi.params.length; i++) {
      const param = fnAbi.params[i];
      if (param && param.name) {
        args[param.name] = i < values.length ? values[i] : undefined;
      }
    }

    // Retain any excess positional arguments as unknown fields
    if (values.length > fnAbi.params.length) {
      args._unknown_params = values.slice(fnAbi.params.length);
    }
  } else {
    // No matching ABI function found — retain positional arguments
    if (values.length > 0) {
      args._positional = values;
    }
  }

  // Preserve all event properties (including raw_xdr, event_xdr, raw_topics, raw_data, and unknown fields)
  const result: DecodedContractEvent<TArgs> = {
    ...event,
    function: fnName,
    args: args as TArgs,
    abi_match: Boolean(fnAbi),
    function_abi: fnAbi,
  };

  return result;
}

/**
 * Creates a reusable typed event decoder for a contract.
 *
 * @param abi Contract metadata or function ABI array
 */
export function createEventDecoder<TMap extends Record<string, any> = Record<string, any>>(
  abi: ContractMeta | FunctionAbi[] | Record<string, FunctionAbi>
): EventDecoder<TMap> {
  const abiMap = normalizeAbiFunctions(abi);
  const functions = Array.from(new Set(Array.from(abiMap.values()).map((f) => f.name)));

  return {
    decode<K extends keyof TMap & string = string>(
      event: RawEvent
    ): DecodedContractEvent<K extends keyof TMap ? TMap[K] : Record<string, unknown>> {
      return decodeEventWithAbi(event, abi) as any;
    },
    supportedFunctions: functions,
    hasFunction(name: string): boolean {
      return abiMap.has(name) || abiMap.has(name.toLowerCase());
    },
    getFunctionAbi(name: string): FunctionAbi | undefined {
      return abiMap.get(name) || abiMap.get(name.toLowerCase());
    },
  };
}

/**
 * Maps Soroban ABI parameter types to TypeScript types.
 */
function mapParamTypeToTs(kind: string): string {
  const lower = (kind || '').toLowerCase();
  if (lower.includes('address') || lower.includes('contract')) return 'string';
  if (lower.includes('bool')) return 'boolean';
  if (lower.includes('string') || lower.includes('symbol')) return 'string';
  if (lower.includes('i128') || lower.includes('u128') || lower.includes('i64') || lower.includes('u64')) {
    return 'string | bigint | number';
  }
  if (lower.includes('u32') || lower.includes('i32') || lower.includes('u16') || lower.includes('i16')) {
    return 'number';
  }
  if (lower.includes('bytes') || lower.includes('vec')) return 'unknown[] | string';
  return 'unknown';
}

/**
 * Generates TypeScript type definitions from Contract ABI metadata.
 * Retains raw XDR access and unknown fields in the generated interface definitions.
 */
export function generateEventTypes(
  meta: ContractMeta,
  options: GenerateTypesOptions = {}
): string {
  const contractName =
    options.typeName ||
    (meta.name ? meta.name.replace(/[^a-zA-Z0-9]/g, '') : 'Contract') + 'Events';
  const functions = meta.functions || [];

  const lines: string[] = [
    '/**',
    ` * Autogenerated event type definitions for ${meta.name || 'Contract'} (${meta.description || ''})`,
    ' * Retains raw XDR access and open indexing for unknown fields.',
    ' */',
    '',
    `export namespace ${contractName} {`,
  ];

  const mapEntries: string[] = [];

  for (const fn of functions) {
    const fnInterfaceName = `${fn.name.charAt(0).toUpperCase() + fn.name.slice(1)}Event`;
    const argsInterfaceName = `${fn.name.charAt(0).toUpperCase() + fn.name.slice(1)}Args`;

    lines.push(`  export interface ${argsInterfaceName} {`);
    for (const param of fn.params || []) {
      const tsType = mapParamTypeToTs(param.kind);
      lines.push(`    /** ${param.description || param.kind} */`);
      lines.push(`    ${param.name}: ${tsType};`);
    }
    lines.push('    /** Additional or unknown arguments */');
    lines.push('    [key: string]: unknown;');
    lines.push('  }');
    lines.push('');

    lines.push(`  export interface ${fnInterfaceName} {`);
    lines.push(`    function: '${fn.name}';`);
    lines.push(`    args: ${argsInterfaceName};`);
    lines.push('    contract_id?: string;');
    lines.push('    ledger?: number;');
    lines.push('    tx_hash?: string;');
    lines.push('    seq?: number;');
    lines.push('    raw_topics?: (string | unknown)[];');
    lines.push('    raw_data?: string | unknown;');
    lines.push('    raw_xdr?: string;');
    lines.push('    event_xdr?: string;');
    lines.push('    description?: string;');
    lines.push('    /** Retains unknown fields from newer indexer or contract versions */');
    lines.push('    [key: string]: unknown;');
    lines.push('  }');
    lines.push('');

    mapEntries.push(`    '${fn.name}': ${argsInterfaceName};`);
  }

  if (options.exportEventMap !== false) {
    lines.push('  export interface EventMap {');
    lines.push(...mapEntries);
    lines.push('    [key: string]: Record<string, unknown>;');
    lines.push('  }');
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
