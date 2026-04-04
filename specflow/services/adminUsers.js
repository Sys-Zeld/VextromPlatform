const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../../configdb/db");
const env = require("../config/env");

const USERS_FILE = path.resolve(env.admin.usersFile);
const SCRYPT_KEY_LENGTH = 64;
const ADMIN_ROLES = new Set(["admin", "user"]);
const MODULE_KEYS = ["specflow", "module-spec", "report-service"];
const MODULE_SET = new Set(MODULE_KEYS);
let ensureStoragePromise = null;

function safeTimingEqualText(a, b) {
  const buffA = Buffer.from(String(a || ""));
  const buffB = Buffer.from(String(b || ""));
  if (buffA.length !== buffB.length) return false;
  return crypto.timingSafeEqual(buffA, buffB);
}

function normalizeUsername(username) {
  return String(username || "").trim();
}

function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase();
  return ADMIN_ROLES.has(value) ? value : "user";
}

function normalizeModuleAccess(moduleAccess, role = "user") {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "admin") return [...MODULE_KEYS];
  if (moduleAccess === null || moduleAccess === undefined) return [...MODULE_KEYS];

  let source = moduleAccess;
  if (typeof source === "string") {
    const text = source.trim();
    if (text.startsWith("[") && text.endsWith("]")) {
      try {
        source = JSON.parse(text);
      } catch (_err) {
        source = [];
      }
    } else if (text) {
      source = text.split(",").map((item) => item.trim());
    } else {
      source = [];
    }
  }

  const list = Array.isArray(source) ? source : [];
  const unique = new Set();
  list.forEach((item) => {
    const key = String(item || "").trim().toLowerCase();
    if (MODULE_SET.has(key)) unique.add(key);
  });

  return Array.from(unique);
}

function normalizeAdminUserRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    username: normalizeUsername(row.username),
    role: normalizeRole(row.role),
    moduleAccess: normalizeModuleAccess(row.module_access || row.moduleAccess, row.role),
    uiFont: String(row.ui_font || row.uiFont || "").trim().toLowerCase(),
    salt: String(row.salt || ""),
    passwordHash: String(row.password_hash || row.passwordHash || ""),
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null
  };
}

function readLegacyUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    return users
      .filter((user) => user && typeof user === "object")
      .map(normalizeAdminUserRow)
      .filter((user) => user.username && user.salt && user.passwordHash);
  } catch (_err) {
    return [];
  }
}

function scryptAsync(value, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(value || ""), String(salt || ""), SCRYPT_KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString("hex"));
    });
  });
}

async function ensureAdminUsersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      module_access JSONB NOT NULL DEFAULT '["specflow","module-spec","report-service"]'::jsonb,
      ui_font TEXT NOT NULL DEFAULT 'inter',
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    ALTER TABLE admin_users
    ADD COLUMN IF NOT EXISTS module_access JSONB NOT NULL DEFAULT '["specflow","module-spec","report-service"]'::jsonb;
  `);
  await db.query(`
    ALTER TABLE admin_users
    ADD COLUMN IF NOT EXISTS ui_font TEXT NOT NULL DEFAULT 'inter';
  `);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username_unique ON admin_users (username);`);
}

async function migrateLegacyUsersFile() {
  const legacyUsers = readLegacyUsers();
  if (!legacyUsers.length) return;

  const existing = await db.query("SELECT COUNT(*)::int AS count FROM admin_users");
  if (Number(existing.rows[0] && existing.rows[0].count) > 0) return;

  await db.query("BEGIN");
  try {
    for (const user of legacyUsers) {
      await db.query(
        `
          INSERT INTO admin_users (id, username, role, module_access, salt, password_hash, created_at, updated_at)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
          ON CONFLICT (username) DO NOTHING
        `,
        [
          user.id || crypto.randomUUID(),
          user.username,
          user.role,
          JSON.stringify(user.moduleAccess || MODULE_KEYS),
          user.salt,
          user.passwordHash,
          user.createdAt || new Date().toISOString(),
          user.updatedAt || user.createdAt || new Date().toISOString()
        ]
      );
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

async function ensureAdminUsersStorageReady() {
  if (!ensureStoragePromise) {
    ensureStoragePromise = (async () => {
      await ensureAdminUsersTable();
      await migrateLegacyUsersFile();
    })().catch((err) => {
      ensureStoragePromise = null;
      throw err;
    });
  }
  return ensureStoragePromise;
}

async function runAdminUsersQuery(queryText, params = []) {
  try {
    return await db.query(queryText, params);
  } catch (err) {
    // 42P01 = relation does not exist
    if (err && err.code === "42P01") {
      ensureStoragePromise = null;
      await ensureAdminUsersStorageReady();
      return db.query(queryText, params);
    }
    throw err;
  }
}

async function listAdminUsers() {
  await ensureAdminUsersStorageReady();
  const result = await runAdminUsersQuery(`
    SELECT id, username, role, module_access, ui_font, created_at, updated_at
    FROM admin_users
    ORDER BY created_at DESC, username ASC
  `);
  return result.rows.map((row) => {
    const user = normalizeAdminUserRow(row);
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      moduleAccess: user.moduleAccess,
      uiFont: user.uiFont,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  });
}

async function getAdminUserRoleByUsername(username) {
  await ensureAdminUsersStorageReady();
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const result = await runAdminUsersQuery(
    `
      SELECT role
      FROM admin_users
      WHERE username = $1
      LIMIT 1
    `,
    [normalized]
  );
  if (!result.rows[0]) return null;
  return normalizeRole(result.rows[0].role);
}

async function getAdminUserAccessByUsername(username) {
  await ensureAdminUsersStorageReady();
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const result = await runAdminUsersQuery(
    `
      SELECT role, module_access, ui_font
      FROM admin_users
      WHERE username = $1
      LIMIT 1
    `,
    [normalized]
  );
  if (!result.rows[0]) return null;
  return {
    role: normalizeRole(result.rows[0].role),
    moduleAccess: normalizeModuleAccess(result.rows[0].module_access, result.rows[0].role),
    uiFont: String(result.rows[0].ui_font || "").trim().toLowerCase()
  };
}

async function verifyAdminUserCredentials(username, password) {
  await ensureAdminUsersStorageReady();
  const normalized = normalizeUsername(username);
  if (!normalized || !password) return null;
  const result = await runAdminUsersQuery(
    `
      SELECT id, username, role, module_access, salt, password_hash, created_at, updated_at
      FROM admin_users
      WHERE username = $1
      LIMIT 1
    `,
    [normalized]
  );
  const user = normalizeAdminUserRow(result.rows[0]);
  if (!user) return null;
  const computedHash = await scryptAsync(password, user.salt);
  if (!safeTimingEqualText(computedHash, user.passwordHash)) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    moduleAccess: user.moduleAccess,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function getAdminUserByUsername(username) {
  await ensureAdminUsersStorageReady();
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const result = await runAdminUsersQuery(
    `
      SELECT id, username, role, module_access, ui_font, created_at, updated_at
      FROM admin_users
      WHERE username = $1
      LIMIT 1
    `,
    [normalized]
  );
  const user = normalizeAdminUserRow(result.rows[0]);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    moduleAccess: user.moduleAccess,
    uiFont: user.uiFont,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function changeAdminUserPasswordByUsername({ username, currentPassword, newPassword }) {
  await ensureAdminUsersStorageReady();
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) throw new Error("Usuario invalido.");
  if (!currentPassword) throw new Error("Informe a senha atual.");
  if (!newPassword || String(newPassword).length < 8) {
    throw new Error("Nova senha deve ter ao menos 8 caracteres.");
  }

  const result = await runAdminUsersQuery(
    `
      SELECT id, username, salt, password_hash
      FROM admin_users
      WHERE username = $1
      LIMIT 1
    `,
    [normalizedUsername]
  );
  const user = normalizeAdminUserRow(result.rows[0]);
  if (!user) {
    throw new Error("Usuario nao encontrado na tabela admin_users.");
  }

  const currentHash = await scryptAsync(currentPassword, user.salt);
  if (!safeTimingEqualText(currentHash, user.passwordHash)) {
    throw new Error("Senha atual invalida.");
  }
  if (safeTimingEqualText(String(currentPassword), String(newPassword))) {
    throw new Error("A nova senha deve ser diferente da atual.");
  }

  const nextSalt = crypto.randomBytes(16).toString("hex");
  const nextHash = await scryptAsync(newPassword, nextSalt);
  await runAdminUsersQuery(
    `
      UPDATE admin_users
      SET salt = $2, password_hash = $3, updated_at = NOW()
      WHERE username = $1
    `,
    [normalizedUsername, nextSalt, nextHash]
  );
}

async function createAdminUser({ username, password, role = "user", moduleAccess = null }) {
  await ensureAdminUsersStorageReady();
  const normalized = normalizeUsername(username);
  const normalizedRole = normalizeRole(role);
  const normalizedModuleAccess = normalizeModuleAccess(moduleAccess, normalizedRole);
  if (!normalized) {
    throw new Error("Usuario invalido.");
  }
  if (!password || String(password).length < 8) {
    throw new Error("Senha deve ter ao menos 8 caracteres.");
  }

  const exists = await runAdminUsersQuery(
    `
      SELECT 1
      FROM admin_users
      WHERE username = $1
      LIMIT 1
    `,
    [normalized]
  );
  if (exists.rows[0]) {
    throw new Error("Usuario ja cadastrado.");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await scryptAsync(password, salt);
  await runAdminUsersQuery(
    `
      INSERT INTO admin_users (id, username, role, module_access, salt, password_hash, created_at, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW(), NOW())
    `,
    [crypto.randomUUID(), normalized, normalizedRole, JSON.stringify(normalizedModuleAccess), salt, passwordHash]
  );
}

async function updateAdminUser({ id, username, role, password, moduleAccess = null }) {
  await ensureAdminUsersStorageReady();
  const normalizedId = String(id || "").trim();
  const normalizedUsername = normalizeUsername(username);
  const normalizedRole = normalizeRole(role);
  const normalizedModuleAccess = normalizeModuleAccess(moduleAccess, normalizedRole);
  if (!normalizedId) throw new Error("Usuario invalido.");
  if (!normalizedUsername) throw new Error("Usuario invalido.");

  const existingResult = await runAdminUsersQuery(
    `
      SELECT id, username, role, module_access, salt, password_hash, created_at, updated_at
      FROM admin_users
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedId]
  );
  const existingUser = normalizeAdminUserRow(existingResult.rows[0]);
  if (!existingUser) throw new Error("Usuario nao encontrado.");

  const duplicate = await runAdminUsersQuery(
    `
      SELECT 1
      FROM admin_users
      WHERE username = $1 AND id <> $2
      LIMIT 1
    `,
    [normalizedUsername, normalizedId]
  );
  if (duplicate.rows[0]) {
    throw new Error("Ja existe outro usuario com este nome.");
  }

  let nextSalt = existingUser.salt;
  let nextPasswordHash = existingUser.passwordHash;
  if (password) {
    if (String(password).length < 8) {
      throw new Error("Senha deve ter ao menos 8 caracteres.");
    }
    nextSalt = crypto.randomBytes(16).toString("hex");
    nextPasswordHash = await scryptAsync(password, nextSalt);
  }

  await runAdminUsersQuery(
    `
      UPDATE admin_users
      SET username = $2, role = $3, module_access = $4::jsonb, salt = $5, password_hash = $6, updated_at = NOW()
      WHERE id = $1
    `,
    [
      normalizedId,
      normalizedUsername,
      normalizedRole,
      JSON.stringify(normalizedModuleAccess),
      nextSalt,
      nextPasswordHash
    ]
  );
}

async function deleteAdminUser(id) {
  await ensureAdminUsersStorageReady();
  const normalizedId = String(id || "").trim();
  if (!normalizedId) throw new Error("Usuario invalido.");

  const result = await runAdminUsersQuery(
    `
      DELETE FROM admin_users
      WHERE id = $1
      RETURNING id, username, role
    `,
    [normalizedId]
  );
  const removedUser = normalizeAdminUserRow(result.rows[0]);
  if (!removedUser) throw new Error("Usuario nao encontrado.");
  return {
    id: removedUser.id,
    username: removedUser.username,
    role: removedUser.role
  };
}

module.exports = {
  getAdminUserRoleByUsername,
  getAdminUserAccessByUsername,
  getAdminUserByUsername,
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  changeAdminUserPasswordByUsername,
  verifyAdminUserCredentials
};
