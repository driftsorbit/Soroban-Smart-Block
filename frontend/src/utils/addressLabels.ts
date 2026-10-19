/**
 * addressLabels.ts — private, browser-only address labels (#1043).
 *
 * Labels live in this browser's localStorage and are never sent to the server.
 * Every access is wrapped so a blocked or unavailable storage leaves the page
 * working with no labels rather than throwing.
 */

export const LABEL_STORAGE_KEY = "soroban-explorer:address-labels:v1";
export const MAX_LABEL_LENGTH = 40;

export type AddressLabels = Record<string, string>;

export type LabelResult = { ok: true; value: string } | { ok: false; error: string };

type LabelStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): LabelStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Trims and validates a label. Control characters and over-long labels are rejected. */
export function normalizeLabel(input: string): LabelResult {
  const value = input.trim();
  if (value.length === 0) return { ok: false, error: "Label cannot be empty." };
  if (value.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: `Label must be ${MAX_LABEL_LENGTH} characters or fewer.` };
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: "Label cannot contain control characters." };
  return { ok: true, value };
}

/** Reads stored labels, discarding anything that is not a string-to-string map. */
export function readLabels(storage: LabelStorage | null = defaultStorage()): AddressLabels {
  if (!storage) return {};
  try {
    const raw = storage.getItem(LABEL_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const labels: AddressLabels = {};
    for (const [address, label] of Object.entries(parsed)) {
      if (typeof label === "string" && normalizeLabel(label).ok) labels[address] = label;
    }
    return labels;
  } catch {
    return {};
  }
}

/** Persists labels. Returns false when storage is unavailable or full. */
export function writeLabels(labels: AddressLabels, storage: LabelStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LABEL_STORAGE_KEY, JSON.stringify(labels));
    return true;
  } catch {
    return false;
  }
}

/** Returns a new label map with `address` set to the validated label. */
export function setAddressLabel(
  labels: AddressLabels,
  address: string,
  input: string,
): { ok: true; labels: AddressLabels } | { ok: false; error: string } {
  const result = normalizeLabel(input);
  if (!result.ok) return result;
  return { ok: true, labels: { ...labels, [address]: result.value } };
}

/** Returns a new label map without `address`. */
export function removeAddressLabel(labels: AddressLabels, address: string): AddressLabels {
  const next = { ...labels };
  delete next[address];
  return next;
}
