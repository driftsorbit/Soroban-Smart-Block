// Validation and share-token helpers for account activity filter presets
// (issue #1049). A preset is { name, fn, from, to }. Saving and editing happen
// in the browser; the server only validates a preset and encodes it into a
// self-contained share token, so it never stores user presets.

import { parseInterval } from "./walletActivity.js";

export const MAX_PRESET_NAME_LENGTH = 60;
export const MAX_PRESET_CATEGORIES = 10;
export const MAX_SHARE_TOKEN_LENGTH = 2048;

const CATEGORY_RE = /^[a-z_]{1,32}$/;
const SHARE_VERSION = 1;

// Returns { ok: true, preset } with a normalised preset, or { ok: false, errors }
// listing every problem found, so a client can show them all at once.
export function validatePreset(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["preset must be an object"] };
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) {
    errors.push("name is required");
  } else if (name.length > MAX_PRESET_NAME_LENGTH) {
    errors.push(`name must be at most ${MAX_PRESET_NAME_LENGTH} characters`);
  }

  let fn = null;
  if (input.fn !== undefined && input.fn !== null && input.fn !== "") {
    if (typeof input.fn !== "string") {
      errors.push("fn must be a comma-separated string of categories");
    } else {
      const categories = input.fn.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      if (categories.length > MAX_PRESET_CATEGORIES) {
        errors.push(`fn may list at most ${MAX_PRESET_CATEGORIES} categories`);
      }
      const bad = categories.filter((value) => !CATEGORY_RE.test(value));
      if (bad.length) errors.push(`fn contains invalid categories: ${bad.join(", ")}`);
      if (!bad.length && categories.length) fn = [...new Set(categories)].join(",");
    }
  }

  let interval = { from: null, to: null };
  try {
    interval = parseInterval({ from: input.from || undefined, to: input.to || undefined });
  } catch (e) {
    errors.push(e.message);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, preset: { name, fn, ...interval } };
}

export function encodeShareToken(preset) {
  const payload = JSON.stringify({ v: SHARE_VERSION, ...preset });
  return Buffer.from(payload, "utf8").toString("base64url");
}

// Decodes and re-validates a share token. Tokens from other sources are
// untrusted, so the decoded preset goes through validatePreset again.
export function decodeShareToken(token) {
  if (typeof token !== "string" || !token || token.length > MAX_SHARE_TOKEN_LENGTH) {
    return { ok: false, errors: ["token is missing or too long"] };
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return { ok: false, errors: ["token is not a valid preset share token"] };
  }
  if (!decoded || decoded.v !== SHARE_VERSION) {
    return { ok: false, errors: ["token version is not supported"] };
  }
  delete decoded.v;
  return validatePreset(decoded);
}
