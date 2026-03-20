const crypto = require("crypto");
const db = require("../db");
const env = require("../config/env");

function toSafeString(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeScope(scope) {
  return toSafeString(scope).toLowerCase();
}

function normalizeScopes(scopes) {
  const source = Array.isArray(scopes) ? scopes : [];
  const unique = new Set();
  source.forEach((scope) => {
    const clean = normalizeScope(scope);
    if (clean) unique.add(clean);
  });
  return Array.from(unique);
}

function hashApiKey(rawKey) {
  const pepper = toSafeString(env.apiKeys.pepper);
  return crypto.createHash("sha256").update(`${pepper}:${String(rawKey || "")}`).digest("hex");
}

function buildApiKeySecret() {
  return `vxt_live_${crypto.randomBytes(24).toString("base64url")}`;
}

function normalizeApiKeyRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    isActive: Boolean(row.is_active),
    expiresAt: row.expires_at || null,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function keyHasScope(apiKey, requiredScope) {
  const required = normalizeScope(requiredScope);
  if (!required) return true;
  const scopes = normalizeScopes(apiKey && apiKey.scopes ? apiKey.scopes : []);
  if (scopes.includes("*")) return true;
  return scopes.includes(required);
}

async function createApiKey({ name, scopes = [], expiresAt = null }) {
  const cleanName = toSafeString(name);
  if (!cleanName) {
    throw new Error("Nome da API key e obrigatorio.");
  }

  const cleanScopes = normalizeScopes(scopes);
  if (!cleanScopes.length) {
    throw new Error("Informe ao menos um escopo para a API key.");
  }

  const secret = buildApiKeySecret();
  const keyHash = hashApiKey(secret);
  const keyPrefix = secret.slice(0, 16);
  const expiry = expiresAt ? new Date(expiresAt) : null;
  if (expiry && Number.isNaN(expiry.getTime())) {
    throw new Error("Data de expiracao invalida.");
  }

  const result = await db.query(
    `
      INSERT INTO api_keys (name, key_prefix, key_hash, scopes, is_active, expires_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, TRUE, $5, NOW(), NOW())
      RETURNING *
    `,
    [cleanName, keyPrefix, keyHash, JSON.stringify(cleanScopes), expiry ? expiry.toISOString() : null]
  );

  return {
    key: secret,
    record: normalizeApiKeyRow(result.rows[0])
  };
}

async function listApiKeys() {
  const result = await db.query(
    `
      SELECT *
      FROM api_keys
      ORDER BY created_at DESC, id DESC
    `
  );
  return result.rows.map(normalizeApiKeyRow);
}

async function revokeApiKey(id) {
  const keyId = Number(id);
  if (!Number.isInteger(keyId) || keyId <= 0) {
    throw new Error("ID de API key invalido.");
  }

  const result = await db.query(
    `
      UPDATE api_keys
      SET is_active = FALSE, revoked_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [keyId]
  );

  if (!result.rows[0]) return null;
  return normalizeApiKeyRow(result.rows[0]);
}

async function deleteApiKey(id) {
  const keyId = Number(id);
  if (!Number.isInteger(keyId) || keyId <= 0) {
    throw new Error("ID de API key invalido.");
  }

  const result = await db.query(
    `
      DELETE FROM api_keys
      WHERE id = $1
      RETURNING *
    `,
    [keyId]
  );

  if (!result.rows[0]) return null;
  return normalizeApiKeyRow(result.rows[0]);
}

async function authenticateApiKey(rawKey) {
  const secret = toSafeString(rawKey);
  if (!secret) return null;

  const keyHash = hashApiKey(secret);
  const result = await db.query(
    `
      SELECT *
      FROM api_keys
      WHERE key_hash = $1
      LIMIT 1
    `,
    [keyHash]
  );

  if (!result.rows[0]) return null;
  const record = normalizeApiKeyRow(result.rows[0]);
  if (!record.isActive) return null;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  await db.query("UPDATE api_keys SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1", [record.id]);
  return record;
}

module.exports = {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  deleteApiKey,
  authenticateApiKey,
  keyHasScope
};
