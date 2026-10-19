/**
 * Verification helpers for signed explorer responses (#904).
 *
 * Request a signed response with `?signed=1` (or
 * `Accept: application/vnd.soroban-explorer.signed+json`), then verify it
 * against the keys published at `/.well-known/explorer-keys.json`. Uses
 * WebCrypto Ed25519 (Node 20+, current browsers).
 */

export interface SignedEnvelope<T = unknown> {
  payload: T;
  ledger: number | null;
  issued_at: string;
  key_id: string;
  /** base64url Ed25519 signature over the JCS form of the other fields */
  signature: string;
}

export interface ExplorerKey {
  key_id: string;
  alg: 'Ed25519';
  /** base64 raw 32-byte public key */
  public_key: string;
  status: 'active' | 'retired';
  not_before: string | null;
  not_after: string | null;
}

export interface VerificationResult {
  valid: boolean;
  /** `retired`: valid, but signed with a key that has since been rotated out. */
  status: 'active' | 'retired' | 'unknown_key' | 'invalid';
}

/** RFC 8785 JSON Canonicalization Scheme (matches indexer/src/signing.js). */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS: non-finite numbers are not allowed');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((v) => (v === undefined || typeof v === 'function' ? 'null' : canonicalize(v)))
      .join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown> & { toJSON?: () => unknown };
    if (typeof obj.toJSON === 'function') return canonicalize(obj.toJSON());
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
  }
  throw new TypeError(`JCS: unsupported type ${typeof value}`);
}

function decode(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Fetch the explorer's published signing keys. */
export async function fetchExplorerKeys(baseUrl: string): Promise<ExplorerKey[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/.well-known/explorer-keys.json`);
  if (!res.ok) throw new Error(`Failed to fetch explorer keys: HTTP ${res.status}`);
  return ((await res.json()) as { keys: ExplorerKey[] }).keys;
}

/** Verify a signed envelope against the published keys. */
export async function verifySignedResponse(
  envelope: SignedEnvelope,
  keys: ExplorerKey[],
): Promise<VerificationResult> {
  const { signature, ...unsigned } = envelope;
  const key = keys.find((k) => k.key_id === unsigned.key_id);
  if (!key) return { valid: false, status: 'unknown_key' };
  try {
    const publicKey = await crypto.subtle.importKey(
      'raw',
      decode(key.public_key),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      decode(signature),
      new TextEncoder().encode(canonicalize(unsigned)),
    );
    if (!ok) return { valid: false, status: 'invalid' };
  } catch {
    return { valid: false, status: 'invalid' };
  }
  return { valid: true, status: key.status === 'retired' ? 'retired' : 'active' };
}

export interface EventInclusionProof {
  leaf: string;
  siblings: string[];
  left: boolean[];
  root: string;
  leafCount: number;
}

/** Verify an event inclusion proof produced by the explorer indexer. */
export async function verifyEventInclusion(
  eventXdr: Uint8Array,
  proof: EventInclusionProof,
): Promise<boolean> {
  const digest = async (bytes: Uint8Array) =>
    new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let current = await digest(eventXdr);
  const expected = proof.leaf.toLowerCase();
  if (Array.from(current, (b) => b.toString(16).padStart(2, "0")).join("") !== expected) return false;
  for (let i = 0; i < proof.siblings.length; i += 1) {
    const sibling = Uint8Array.from(proof.siblings[i].match(/.{2}/g) ?? [], (x) => parseInt(x, 16));
    const pair = new Uint8Array(64);
    if (proof.left[i]) {
      pair.set(sibling);
      pair.set(current, 32);
    } else {
      pair.set(current);
      pair.set(sibling, 32);
    }
    current = await digest(pair);
  }
  return Array.from(current, (b) => b.toString(16).padStart(2, "0")).join("") === proof.root.toLowerCase();
}
