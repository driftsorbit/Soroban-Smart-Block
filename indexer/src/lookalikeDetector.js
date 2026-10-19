/**
 * Lookalike Contract Name & Phishing Risk Detector (#1121)
 *
 * Evaluates contract names for deception, typosquatting, homoglyph substitution,
 * and impersonation suffixes targeting well-known/verified Stellar identities,
 * while maintaining the on-chain contract ID as the sole authoritative identifier.
 */

// Known verified identities on Stellar / Soroban
export const VERIFIED_IDENTITIES = Object.freeze([
  {
    key: "USDC",
    names: ["USDC", "USD Coin", "Circle USDC", "Circle"],
    description: "Centre / Circle USD Coin on Stellar",
  },
  {
    key: "EURC",
    names: ["EURC", "Euro Coin", "Circle EURC"],
    description: "Circle Euro Coin on Stellar",
  },
  {
    key: "XLM",
    names: ["XLM", "Stellar", "Lumen", "Stellar Lumens"],
    description: "Stellar native network asset",
  },
  {
    key: "AQUA",
    names: ["AQUA", "Aquarius"],
    description: "Aquarius liquidity reward token",
  },
  {
    key: "USDT",
    names: ["USDT", "Tether", "Tether USD"],
    description: "Tether USD token",
  },
  {
    key: "Soroswap",
    names: ["Soroswap", "Soroswap Router", "Soroswap Factory"],
    description: "Soroswap decentralized exchange",
  },
  {
    key: "Blend",
    names: ["Blend", "Blend Protocol", "Blend Pool"],
    description: "Blend capital lending protocol",
  },
  {
    key: "Phoenix",
    names: ["Phoenix", "Phoenix DEX"],
    description: "Phoenix decentralized exchange",
  },
]);

// Confusable / homoglyph mapping (common Cyrillic, Greek, and digit lookalikes to Latin letters)
const HOMOGLYPH_MAP = {
  // Cyrillic lookalikes
  "\u0430": "a",
  "\u0410": "a", // а, А
  "\u0441": "c",
  "\u0421": "c", // с, С
  "\u0435": "e",
  "\u0415": "e", // е, Е
  "\u043E": "o",
  "\u041E": "o", // о, О
  "\u0440": "p",
  "\u0420": "p", // р, Р
  "\u0455": "s",
  "\u0405": "s", // ѕ, Ѕ
  "\u0445": "x",
  "\u0425": "x", // х, Х
  "\u0443": "y",
  "\u0423": "y", // у, У
  "\u0456": "i",
  "\u0406": "i", // і, І
  "\u0458": "j",
  "\u0408": "j", // ј, Ј
  "\u0412": "b", // В
  "\u041C": "m", // М
  "\u0422": "t", // Т
  "\u041D": "h", // Н
  // Leetspeak / digit substitutions
  0: "o",
  1: "l",
  3: "e",
  4: "a",
  5: "s",
  8: "b",
  $: "s",
  "@": "a",
};

const IMPERSONATION_WORDS = [
  "official",
  "verified",
  "airdrop",
  "giveaway",
  "claim",
  "support",
  "bonus",
  "reward",
  "foundation",
  "portal",
  "admin",
  "secure",
  "vault",
];

/**
 * Replace common homoglyphs and leetspeak characters with normalized Latin equivalents.
 */
export function normalizeHomoglyphs(str) {
  if (typeof str !== "string") return "";
  let out = "";
  for (const char of str) {
    out += HOMOGLYPH_MAP[char] ?? char;
  }
  return out;
}

/**
 * Standard Levenshtein distance between two strings.
 */
export function levenshteinDistance(a, b) {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const matrix = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) matrix[i][0] = i;
  for (let j = 0; j <= bl; j++) matrix[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  return matrix[al][bl];
}

/**
 * Detect whether a contract's name resembles a verified identity without verified authorization.
 *
 * @param {object} contract - Contract metadata object
 * @param {string} [contract.id] - Contract ID
 * @param {string} [contract.name] - Contract name
 * @param {boolean} [contract.is_verified] - On-chain ABI verification status
 * @param {boolean} [contract.ownership_verified] - On-chain ownership verification status
 * @returns {object} Detection result with warning and authoritative contract ID context
 */
export function detectLookalikeRisk(contract = {}) {
  const defaultSafe = { is_lookalike: false };
  if (!contract || typeof contract !== "object") return defaultSafe;

  const rawName = typeof contract.name === "string" ? contract.name.trim() : "";
  if (!rawName) return defaultSafe;

  const contractId = typeof contract.id === "string" ? contract.id : "";
  const isVerified = Boolean(contract.is_verified || contract.ownership_verified);

  // If already verified through official cryptographic checks, no lookalike warning
  if (isVerified) return defaultSafe;

  const cleanRaw = rawName.toLowerCase();
  const normalized = normalizeHomoglyphs(rawName)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  for (const identity of VERIFIED_IDENTITIES) {
    for (const idName of identity.names) {
      const targetClean = idName.toLowerCase();
      const targetNormalized = targetClean.replace(/[^a-z0-9]/g, "");

      // 1. Exact unverified match (e.g. naming an unverified contract "USDC")
      if (cleanRaw === targetClean || normalized === targetNormalized) {
        const isHomoglyph = cleanRaw !== targetClean && normalized === targetNormalized;
        return {
          is_lookalike: true,
          resembles: identity.key,
          similarity_type: isHomoglyph ? "homoglyph" : "exact_unverified",
          risk_level: "high",
          warning: `Contract name matches verified identity '${identity.key}' but has not been verified. Verify the authoritative Contract ID before interacting.`,
          authoritative_contract_id: contractId,
        };
      }

      // 2. Impersonation words combined with verified name (e.g. "USDC Official", "Stellar Airdrop")
      const words = cleanRaw.split(/[\s\-_.:/]+/);
      const containsTarget = words.includes(targetClean) || cleanRaw.includes(targetClean);
      const containsImpersonationWord = IMPERSONATION_WORDS.some(
        (word) => cleanRaw.includes(word) || words.includes(word),
      );

      if (containsTarget && containsImpersonationWord) {
        return {
          is_lookalike: true,
          resembles: identity.key,
          similarity_type: "impersonation_suffix",
          risk_level: "high",
          warning: `Contract name combines verified identity '${identity.key}' with suspicious keywords (${rawName}). Verify the authoritative Contract ID before interacting.`,
          authoritative_contract_id: contractId,
        };
      }

      // 3. Typosquatting / edit distance (1 or 2 character edits away)
      // Only evaluate if strings are of comparable length (within 2 chars) and long enough (>= 3 chars)
      if (
        targetNormalized.length >= 3 &&
        Math.abs(normalized.length - targetNormalized.length) <= 2 &&
        normalized.length >= 3
      ) {
        const dist = levenshteinDistance(normalized, targetNormalized);
        if (dist >= 1 && dist <= 2) {
          return {
            is_lookalike: true,
            resembles: identity.key,
            similarity_type: "typosquat",
            risk_level: dist === 1 ? "high" : "medium",
            warning: `Contract name '${rawName}' closely resembles verified identity '${identity.key}'. Verify the authoritative Contract ID before interacting.`,
            authoritative_contract_id: contractId,
          };
        }
      }
    }
  }

  return defaultSafe;
}
