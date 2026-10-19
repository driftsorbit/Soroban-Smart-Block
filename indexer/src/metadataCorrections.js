// Issue #1059 — validation for public metadata correction requests.

export const CORRECTABLE_FIELDS = {
  name: { max: 200 },
  description: { max: 2000 },
};

const REASON_MAX = 500;

// Returns { error } or { field, new_value, reason }. The actor is never taken from
// the request body; the route derives it from the authenticated API key.
export function validateCorrection(body) {
  if (!body || typeof body !== "object") return { error: "Request body must be a JSON object" };
  const { field, new_value: newValue, reason } = body;
  if (!Object.hasOwn(CORRECTABLE_FIELDS, field)) {
    return { error: `field must be one of: ${Object.keys(CORRECTABLE_FIELDS).join(", ")}` };
  }
  const max = CORRECTABLE_FIELDS[field].max;
  if (typeof newValue !== "string" || newValue.trim() === "" || newValue.length > max) {
    return { error: `new_value must be a non-empty string of at most ${max} characters` };
  }
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > REASON_MAX) {
    return { error: `reason must be a non-empty string of at most ${REASON_MAX} characters` };
  }
  return { field, new_value: newValue, reason: reason.trim() };
}
