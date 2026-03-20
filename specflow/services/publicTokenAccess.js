const crypto = require("crypto");
const db = require("../db");
const env = require("../config/env");

const MAX_TOKENS_PER_WINDOW = 10;
const WINDOW_HOURS = 12;
const PUBLIC_TOKEN_ACCESS_KEY = "public_token_access_enabled";

function parseBooleanSetting(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

async function getSetting(key) {
  const result = await db.query("SELECT value FROM app_settings WHERE key = $1", [key]);
  return result.rows[0]?.value ?? null;
}

async function upsertSetting(key, value) {
  await db.query(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [key, String(value)]
  );
}

async function isPublicTokenAccessEnabled() {
  const raw = await getSetting(PUBLIC_TOKEN_ACCESS_KEY);
  if (raw === null) return false;
  return parseBooleanSetting(raw);
}

async function setPublicTokenAccessEnabled(enabled) {
  await upsertSetting(PUBLIC_TOKEN_ACCESS_KEY, enabled ? "true" : "false");
  return Boolean(enabled);
}

function hashIdentifier(value) {
  const secret = env.admin.sessionSecret || "public-token-fallback";
  return crypto.createHmac("sha256", secret).update(String(value || "")).digest("hex");
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

async function countRecentTokenCreationsByHash(fieldName, hashValue) {
  const result = await db.query(
    `
      SELECT COUNT(*)::int AS total
      FROM token_creation_audit
      WHERE channel = 'public'
        AND ${fieldName} = $1
        AND created_at >= NOW() - INTERVAL '${WINDOW_HOURS} hours'
    `,
    [hashValue]
  );
  return Number(result.rows[0]?.total || 0);
}

async function checkPublicTokenCreationLimit({ ipHash, browserSessionHash }) {
  const [ipCount, browserCount] = await Promise.all([
    countRecentTokenCreationsByHash("ip_hash", ipHash),
    countRecentTokenCreationsByHash("browser_session_hash", browserSessionHash)
  ]);
  return {
    ipCount,
    browserCount,
    blocked: ipCount >= MAX_TOKENS_PER_WINDOW || browserCount >= MAX_TOKENS_PER_WINDOW
  };
}

async function registerTokenCreationAudit({
  equipmentId,
  channel = "public",
  ipHash = null,
  browserSessionHash = null,
  userAgentHash = null
}) {
  await db.query(
    `
      INSERT INTO token_creation_audit (
        equipment_id,
        channel,
        ip_hash,
        browser_session_hash,
        user_agent_hash,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [equipmentId, channel, ipHash, browserSessionHash, userAgentHash]
  );
}

module.exports = {
  MAX_TOKENS_PER_WINDOW,
  WINDOW_HOURS,
  isPublicTokenAccessEnabled,
  setPublicTokenAccessEnabled,
  hashIdentifier,
  getClientIp,
  checkPublicTokenCreationLimit,
  registerTokenCreationAudit
};
