import { xdr, Address, StrKey } from "@stellar/stellar-sdk";

export type ValueType =
  | "bool"
  | "u32"
  | "i32"
  | "u64"
  | "i64"
  | "u128"
  | "i128"
  | "string"
  | "symbol"
  | "bytes"
  | "vec"
  | "map"
  | "struct"
  | "enum"
  | "address";

export interface TestVectorPreset {
  id: string;
  name: string;
  category: "primitive" | "vector" | "map" | "struct" | "enum" | "address";
  type: ValueType;
  description: string;
  defaultJson: string;
}

export const TEST_VECTOR_PRESETS: TestVectorPreset[] = [
  // ── Primitives ─────────────────────────────────────────────────────────────
  {
    id: "primitive-bool-true",
    name: "Boolean (true)",
    category: "primitive",
    type: "bool",
    description: "Boolean value true",
    defaultJson: "true",
  },
  {
    id: "primitive-bool-false",
    name: "Boolean (false)",
    category: "primitive",
    type: "bool",
    description: "Boolean value false",
    defaultJson: "false",
  },
  {
    id: "primitive-u32",
    name: "Unsigned 32-bit Integer (u32)",
    category: "primitive",
    type: "u32",
    description: "32-bit unsigned integer (0 to 4294967295)",
    defaultJson: "1000000",
  },
  {
    id: "primitive-i32",
    name: "Signed 32-bit Integer (i32)",
    category: "primitive",
    type: "i32",
    description: "32-bit signed integer (-2147483648 to 2147483647)",
    defaultJson: "-42",
  },
  {
    id: "primitive-u64",
    name: "Unsigned 64-bit Integer (u64)",
    category: "primitive",
    type: "u64",
    description: "64-bit unsigned integer as numeric string or number",
    defaultJson: '"18446744073709551615"',
  },
  {
    id: "primitive-i64",
    name: "Signed 64-bit Integer (i64)",
    category: "primitive",
    type: "i64",
    description: "64-bit signed integer as numeric string or number",
    defaultJson: '"-9223372036854775808"',
  },
  {
    id: "primitive-u128",
    name: "Unsigned 128-bit Integer (u128)",
    category: "primitive",
    type: "u128",
    description: "128-bit unsigned integer represented as string",
    defaultJson: '"340282366920938463463374607431768211455"',
  },
  {
    id: "primitive-i128",
    name: "Signed 128-bit Integer (i128)",
    category: "primitive",
    type: "i128",
    description: "128-bit signed integer represented as string",
    defaultJson: '"-170141183460469231731687303715884105728"',
  },
  {
    id: "primitive-string",
    name: "String",
    category: "primitive",
    type: "string",
    description: "Soroban UTF-8 string",
    defaultJson: '"Hello, Soroban!"',
  },
  {
    id: "primitive-symbol",
    name: "Symbol",
    category: "primitive",
    type: "symbol",
    description: "Soroban alphanumeric identifier symbol (max 32 chars)",
    defaultJson: '"transfer"',
  },
  {
    id: "primitive-bytes",
    name: "Bytes (Hex)",
    category: "primitive",
    type: "bytes",
    description: "Raw byte array encoded as hex string",
    defaultJson: '"deadbeefcafe0123456789abcdef"',
  },

  // ── Vectors ────────────────────────────────────────────────────────────────
  {
    id: "vector-numbers",
    name: "Vector of Integers",
    category: "vector",
    type: "vec",
    description: "Ordered array of 32-bit integers",
    defaultJson: "[10, 20, 30, 40, 50]",
  },
  {
    id: "vector-strings",
    name: "Vector of Strings",
    category: "vector",
    type: "vec",
    description: "Ordered array of strings",
    defaultJson: '["stellar", "soroban", "wasm", "rust"]',
  },
  {
    id: "vector-empty",
    name: "Empty Vector",
    category: "vector",
    type: "vec",
    description: "Empty vector array []",
    defaultJson: "[]",
  },

  // ── Maps ───────────────────────────────────────────────────────────────────
  {
    id: "map-key-value",
    name: "String-to-Int Map",
    category: "map",
    type: "map",
    description: "Map with string keys and integer values",
    defaultJson: '{\n  "allowance": 1000,\n  "nonce": 42,\n  "limit": 5000\n}',
  },
  {
    id: "map-empty",
    name: "Empty Map",
    category: "map",
    type: "map",
    description: "Empty map object {}",
    defaultJson: "{}",
  },

  // ── Structs ────────────────────────────────────────────────────────────────
  {
    id: "struct-token-meta",
    name: "Token Metadata Struct",
    category: "struct",
    type: "struct",
    description: "Composite struct representing token definition",
    defaultJson: '{\n  "name": "Stellar Lumens",\n  "symbol": "XLM",\n  "decimals": 7,\n  "supply": "100000000000"\n}',
  },
  {
    id: "struct-user-profile",
    name: "User Account Struct",
    category: "struct",
    type: "struct",
    description: "User profile record with address and status",
    defaultJson: '{\n  "owner": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",\n  "active": true,\n  "tier": 1\n}',
  },

  // ── Enums ──────────────────────────────────────────────────────────────────
  {
    id: "enum-unit",
    name: "Unit Variant Enum",
    category: "enum",
    type: "enum",
    description: "Enum variant without payload (e.g. status flag)",
    defaultJson: '{\n  "variant": "Active"\n}',
  },
  {
    id: "enum-tuple",
    name: "Tuple / Data Variant Enum",
    category: "enum",
    type: "enum",
    description: "Enum variant with payload arguments",
    defaultJson: '{\n  "variant": "Deposit",\n  "values": [5000, "XLM"]\n}',
  },

  // ── Addresses ──────────────────────────────────────────────────────────────
  {
    id: "address-account",
    name: "Stellar Account Address (G...)",
    category: "address",
    type: "address",
    description: "Ed25519 public key account address",
    defaultJson: '"GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"',
  },
  {
    id: "address-contract",
    name: "Soroban Contract Address (C...)",
    category: "address",
    type: "address",
    description: "32-byte contract ID address",
    defaultJson: '"CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"',
  },
];

function parseHex(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error(`Invalid hex byte string: "${hex}"`);
  }
  return Buffer.from(clean, "hex");
}

export function jsonToScVal(type: ValueType, value: any): xdr.ScVal {
  if (value === undefined || value === null) {
    return xdr.ScVal.scvVoid();
  }

  switch (type) {
    case "bool": {
      if (typeof value !== "boolean") {
        if (value === "true") return xdr.ScVal.scvBool(true);
        if (value === "false") return xdr.ScVal.scvBool(false);
        throw new Error(`Expected boolean, got ${typeof value}`);
      }
      return xdr.ScVal.scvBool(value);
    }
    case "u32": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 4294967295) {
        throw new Error(`Invalid u32: ${value}`);
      }
      return xdr.ScVal.scvU32(n);
    }
    case "i32": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) {
        throw new Error(`Invalid i32: ${value}`);
      }
      return xdr.ScVal.scvI32(n);
    }
    case "u64": {
      const b = BigInt(value);
      if (b < 0n || b > 18446744073709551615n) throw new Error(`Invalid u64: ${value}`);
      return xdr.ScVal.scvU64(xdr.Uint64.fromString(b.toString()));
    }
    case "i64": {
      const b = BigInt(value);
      if (b < -9223372036854775808n || b > 9223372036854775807n) throw new Error(`Invalid i64: ${value}`);
      return xdr.ScVal.scvI64(xdr.Int64.fromString(b.toString()));
    }
    case "u128": {
      const b = BigInt(value);
      if (b < 0n || b > (1n << 128n) - 1n) throw new Error(`u128 out of bounds: ${value}`);
      const hi = b >> 64n;
      const lo = b & 0xffffffffffffffffn;
      return xdr.ScVal.scvU128(
        new xdr.UInt128Parts({
          hi: xdr.Uint64.fromString(hi.toString()),
          lo: xdr.Uint64.fromString(lo.toString()),
        }),
      );
    }
    case "i128": {
      const b = BigInt(value);
      const min = -(1n << 127n);
      const max = (1n << 127n) - 1n;
      if (b < min || b > max) throw new Error(`i128 out of bounds: ${value}`);
      const unsigned = b < 0n ? b + (1n << 128n) : b;
      const hiBig = unsigned >> 64n;
      const loBig = unsigned & 0xffffffffffffffffn;
      const hiSigned = hiBig >= (1n << 63n) ? hiBig - (1n << 64n) : hiBig;
      return xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          hi: xdr.Int64.fromString(hiSigned.toString()),
          lo: xdr.Uint64.fromString(loBig.toString()),
        }),
      );
    }
    case "string":
      return xdr.ScVal.scvString(String(value));
    case "symbol": {
      const sym = String(value);
      if (sym.length > 32) throw new Error(`Symbol exceeds 32 characters: "${sym}"`);
      return xdr.ScVal.scvSymbol(sym);
    }
    case "bytes": {
      const buf = typeof value === "string" ? parseHex(value) : Buffer.from(value);
      return xdr.ScVal.scvBytes(buf);
    }
    case "address": {
      const addr = String(value).trim();
      if (!/^[GC][A-Z2-7]{55}$/.test(addr)) {
        throw new Error(`Invalid Stellar address checksum or format: "${addr}"`);
      }
      return new Address(addr).toScVal();
    }
    case "vec": {
      if (!Array.isArray(value)) throw new Error("Vector value must be an array");
      const items = value.map((item) => inferToScVal(item));
      return xdr.ScVal.scvVec(items);
    }
    case "map":
    case "struct": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${type} value must be a key-value object`);
      }
      const entries: xdr.ScMapEntry[] = Object.entries(value).map(([k, v]) => {
        return new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol(k),
          val: inferToScVal(v),
        });
      });
      // Sort map entries by key symbol as required by Soroban canonical XDR order
      entries.sort((a, b) => a.key().sym().toString().localeCompare(b.key().sym().toString()));
      return xdr.ScVal.scvMap(entries);
    }
    case "enum": {
      if (typeof value === "string") {
        return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(value)]);
      }
      if (typeof value === "object" && value !== null) {
        const variant = value.variant || value.type || Object.keys(value)[0];
        if (!variant) throw new Error("Enum must specify a variant name");
        const variantVal = value.values || value.value || value[variant];
        if (variantVal === undefined || variantVal === null) {
          return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(String(variant))]);
        }
        const payload = Array.isArray(variantVal) ? variantVal.map(inferToScVal) : [inferToScVal(variantVal)];
        return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(String(variant)), ...payload]);
      }
      throw new Error(`Invalid enum format: ${JSON.stringify(value)}`);
    }
    default:
      return inferToScVal(value);
  }
}

/** Automatically infer ScVal from primitive JS type */
export function inferToScVal(value: any): xdr.ScVal {
  if (value === null || value === undefined) return xdr.ScVal.scvVoid();
  if (typeof value === "boolean") return xdr.ScVal.scvBool(value);
  if (typeof value === "number") {
    return Number.isInteger(value) ? xdr.ScVal.scvI32(value) : xdr.ScVal.scvString(String(value));
  }
  if (typeof value === "bigint") {
    return xdr.ScVal.scvI64(xdr.Int64.fromString(value.toString()));
  }
  if (typeof value === "string") {
    if (/^[GC][A-Z2-7]{55}$/.test(value)) {
      try {
        return new Address(value).toScVal();
      } catch {
        // fallback
      }
    }
    return xdr.ScVal.scvString(value);
  }
  if (Array.isArray(value)) {
    return xdr.ScVal.scvVec(value.map(inferToScVal));
  }
  if (typeof value === "object") {
    const entries: xdr.ScMapEntry[] = Object.entries(value).map(([k, v]) => {
      return new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol(k),
        val: inferToScVal(v),
      });
    });
    entries.sort((a, b) => a.key().sym().toString().localeCompare(b.key().sym().toString()));
    return xdr.ScVal.scvMap(entries);
  }
  return xdr.ScVal.scvString(String(value));
}

export function scValToJson(val: xdr.ScVal): { type: ValueType; value: any } {
  switch (val.switch()) {
    case xdr.ScValType.scvBool():
      return { type: "bool", value: val.b() };
    case xdr.ScValType.scvVoid():
      return { type: "bool", value: null };
    case xdr.ScValType.scvU32():
      return { type: "u32", value: val.u32() };
    case xdr.ScValType.scvI32():
      return { type: "i32", value: val.i32() };
    case xdr.ScValType.scvU64():
      return { type: "u64", value: val.u64().toString() };
    case xdr.ScValType.scvI64():
      return { type: "i64", value: val.i64().toString() };
    case xdr.ScValType.scvU128(): {
      const u = val.u128();
      const big = (BigInt(u.hi().toString()) << 64n) | BigInt(u.lo().toString());
      return { type: "u128", value: big.toString() };
    }
    case xdr.ScValType.scvI128(): {
      const i = val.i128();
      const hi = BigInt(i.hi().toString());
      const lo = BigInt(i.lo().toString());
      const unsigned = (hi << 64n) | lo;
      const signed = unsigned >= (1n << 127n) ? unsigned - (1n << 128n) : unsigned;
      return { type: "i128", value: signed.toString() };
    }
    case xdr.ScValType.scvBytes():
      return { type: "bytes", value: val.bytes().toString("hex") };
    case xdr.ScValType.scvString():
      return { type: "string", value: val.str().toString() };
    case xdr.ScValType.scvSymbol():
      return { type: "symbol", value: val.sym().toString() };
    case xdr.ScValType.scvAddress(): {
      try {
        const addr = Address.fromScVal(val);
        return { type: "address", value: addr.toString() };
      } catch {
        return { type: "address", value: "unknown" };
      }
    }
    case xdr.ScValType.scvVec(): {
      const items = val.vec() || [];
      return { type: "vec", value: items.map((item) => scValToJson(item).value) };
    }
    case xdr.ScValType.scvMap(): {
      const entries = val.map() || [];
      const obj: Record<string, any> = {};
      for (const e of entries) {
        const k = scValToJson(e.key()).value;
        const v = scValToJson(e.val()).value;
        obj[String(k)] = v;
      }
      return { type: "map", value: obj };
    }
    default:
      return { type: "string", value: "…" };
  }
}

export interface RoundTripResult {
  ok: boolean;
  roundTripValue?: any;
  xdrBase64?: string;
  error?: string;
}

/** Converts JSON value to ScVal XDR, converts back to JSON, and verifies equality */
export function verifyRoundTrip(type: ValueType, value: any): RoundTripResult {
  try {
    if (value === undefined || value === "") {
      return { ok: false, error: "Empty value provided" };
    }

    const scVal = jsonToScVal(type, value);
    const xdrBase64 = scVal.toXDR("base64");

    // Deserialize back from base64
    const restoredScVal = xdr.ScVal.fromXDR(xdrBase64, "base64");
    const restoredJson = scValToJson(restoredScVal);

    return {
      ok: true,
      roundTripValue: restoredJson.value,
      xdrBase64,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err.message || String(err),
    };
  }
}
