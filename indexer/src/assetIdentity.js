/**
 * Classic asset identity resolution (#1066).
 *
 * A classic asset is identified by the pair (code, issuer). Records are only
 * merged when BOTH match. Same-code assets from different issuers stay as
 * separate identities and are reported as `same_code_other_issuers` so the UI
 * can show the association without treating them as the same asset.
 */

/**
 * @param {Array<{code: string, issuer: string, source?: string}>} candidates
 * @returns {{ status: "empty"|"ok", identities: object[], skipped: number }}
 */
export function resolveAssetIdentity(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { status: "empty", identities: [], skipped: 0 };
  }

  const groups = new Map();
  let skipped = 0;
  for (const c of candidates) {
    if (!c || typeof c.code !== "string" || typeof c.issuer !== "string" || !c.code || !c.issuer) {
      skipped++;
      continue;
    }
    const key = `${c.code}:${c.issuer}`;
    if (!groups.has(key)) {
      groups.set(key, { code: c.code, issuer: c.issuer, evidence: [] });
    }
    if (c.source) groups.get(key).evidence.push(c.source);
  }

  const identities = [...groups.values()].map((identity) => ({
    ...identity,
    same_code_other_issuers: [...groups.values()]
      .filter((other) => other.code === identity.code && other.issuer !== identity.issuer)
      .map((other) => other.issuer)
      .sort(),
  }));

  identities.sort((a, b) => (a.code === b.code ? a.issuer.localeCompare(b.issuer) : a.code.localeCompare(b.code)));
  return { status: identities.length ? "ok" : "empty", identities, skipped };
}
