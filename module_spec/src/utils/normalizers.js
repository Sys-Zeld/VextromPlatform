function toSafeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNullableString(value) {
  const normalized = toSafeString(value);
  return normalized || null;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = toSafeString(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function toNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  const unique = new Set();
  ensureArray(values).forEach((value) => {
    const normalized = toSafeString(value);
    if (normalized) unique.add(normalized);
  });
  return Array.from(unique);
}

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_err) {
    return fallback;
  }
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_err) {
    return fallback;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  toSafeString,
  toNullableString,
  toBoolean,
  toInteger,
  toNumber,
  ensureArray,
  uniqueStrings,
  parseJsonObject,
  parseJsonArray,
  cloneJson
};
