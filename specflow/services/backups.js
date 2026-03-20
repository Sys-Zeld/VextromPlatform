const fs = require("fs");
const path = require("path");
const db = require("../db");

const BACKUP_FILE_NAME_REGEX = /^db-backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sql$/i;
let backupCatalogEnsured = false;
let backupCatalogEnsurePromise = null;

function isBackupTableMissingError(err) {
  const message = String(err && err.message ? err.message : "").toLowerCase();
  return Boolean(err && err.code === "42P01" && message.includes("backup_files"));
}

async function ensureBackupCatalogTable() {
  if (backupCatalogEnsured) return;
  if (backupCatalogEnsurePromise) {
    await backupCatalogEnsurePromise;
    return;
  }

  backupCatalogEnsurePromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS backup_files (
        id BIGSERIAL PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        folder_path TEXT NOT NULL,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        backup_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.query(`ALTER TABLE backup_files ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '';`);
    await db.query(`ALTER TABLE backup_files ADD COLUMN IF NOT EXISTS file_path TEXT NOT NULL DEFAULT '';`);
    await db.query(`ALTER TABLE backup_files ADD COLUMN IF NOT EXISTS folder_path TEXT NOT NULL DEFAULT '';`);
    await db.query(`ALTER TABLE backup_files ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0;`);
    await db.query(`ALTER TABLE backup_files ADD COLUMN IF NOT EXISTS backup_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await db.query(`ALTER TABLE backup_files ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await db.query(`ALTER TABLE backup_files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_files_path_unique ON backup_files (file_path);`);
  })();

  try {
    await backupCatalogEnsurePromise;
    backupCatalogEnsured = true;
  } finally {
    backupCatalogEnsurePromise = null;
  }
}

async function queryBackupCatalog(sql, params = []) {
  if (!backupCatalogEnsured) {
    await ensureBackupCatalogTable();
  }

  try {
    return await db.query(sql, params);
  } catch (err) {
    if (!isBackupTableMissingError(err)) throw err;
    backupCatalogEnsured = false;
    await ensureBackupCatalogTable();
    return db.query(sql, params);
  }
}

function normalizeBackupRow(row) {
  const filePath = String(row.file_path || "");
  return {
    id: Number(row.id),
    fileName: row.file_name || path.basename(filePath),
    filePath,
    folderPath: row.folder_path || path.dirname(filePath),
    sizeBytes: Number(row.size_bytes || 0),
    backupTimestamp: row.backup_timestamp || row.created_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    existsOnDisk: filePath ? fs.existsSync(filePath) : false
  };
}

function parseTimestampFromBackupName(fileName) {
  const match = String(fileName || "").match(BACKUP_FILE_NAME_REGEX);
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

async function upsertBackupFileRecord(filePath, options = {}) {
  const absolutePath = path.resolve(String(filePath || "").trim());
  if (!absolutePath) {
    throw new Error("Caminho do backup invalido.");
  }

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Arquivo de backup nao encontrado: ${absolutePath}`);
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`Caminho de backup nao e arquivo: ${absolutePath}`);
  }

  const fileName = path.basename(absolutePath);
  const folderPath = path.dirname(absolutePath);
  const parsedByName = parseTimestampFromBackupName(fileName);
  const backupTimestamp = options.backupTimestamp || parsedByName || stat.mtime;
  const backupTimestampIso = new Date(backupTimestamp).toISOString();

  const result = await queryBackupCatalog(
    `
      INSERT INTO backup_files (
        file_name,
        file_path,
        folder_path,
        size_bytes,
        backup_timestamp,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (file_path)
      DO UPDATE SET
        file_name = EXCLUDED.file_name,
        folder_path = EXCLUDED.folder_path,
        size_bytes = EXCLUDED.size_bytes,
        backup_timestamp = EXCLUDED.backup_timestamp,
        updated_at = NOW()
      RETURNING *
    `,
    [fileName, absolutePath, folderPath, Number(stat.size || 0), backupTimestampIso]
  );

  return normalizeBackupRow(result.rows[0]);
}

async function syncBackupsFromDirectory(backupDirPath) {
  const backupDir = path.resolve(String(backupDirPath || "").trim());
  if (!backupDir || !fs.existsSync(backupDir)) return 0;

  const entries = fs.readdirSync(backupDir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"))
    .map((entry) => path.join(backupDir, entry.name));

  for (const filePath of sqlFiles) {
    await upsertBackupFileRecord(filePath);
  }

  return sqlFiles.length;
}

async function listBackupFiles() {
  const result = await queryBackupCatalog(
    `
      SELECT *
      FROM backup_files
      ORDER BY backup_timestamp DESC, id DESC
    `
  );
  return result.rows.map(normalizeBackupRow);
}

async function getBackupFileById(id) {
  const backupId = Number(id);
  if (!Number.isInteger(backupId) || backupId <= 0) {
    throw new Error("ID de backup invalido.");
  }

  const result = await queryBackupCatalog(
    `
      SELECT *
      FROM backup_files
      WHERE id = $1
      LIMIT 1
    `,
    [backupId]
  );

  if (!result.rows[0]) return null;
  return normalizeBackupRow(result.rows[0]);
}

async function deleteBackupFileById(id, options = {}) {
  const backupId = Number(id);
  if (!Number.isInteger(backupId) || backupId <= 0) {
    throw new Error("ID de backup invalido.");
  }

  const removeFromDisk = options.removeFromDisk !== false;
  const existing = await getBackupFileById(backupId);
  if (!existing) return null;

  let removedFromDisk = false;
  let diskStatus = "not_requested";
  if (removeFromDisk) {
    const absolutePath = path.resolve(String(existing.filePath || "").trim());
    if (!absolutePath) {
      throw new Error("Caminho de backup invalido para exclusao.");
    }
    if (fs.existsSync(absolutePath)) {
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) {
        throw new Error(`Caminho de backup nao e arquivo: ${absolutePath}`);
      }
      fs.unlinkSync(absolutePath);
      removedFromDisk = true;
      diskStatus = "deleted";
    } else {
      diskStatus = "missing";
    }
  }

  await queryBackupCatalog(
    `
      DELETE FROM backup_files
      WHERE id = $1
    `,
    [backupId]
  );

  return {
    backup: existing,
    removedFromDisk,
    diskStatus
  };
}

module.exports = {
  listBackupFiles,
  getBackupFileById,
  deleteBackupFileById,
  syncBackupsFromDirectory,
  upsertBackupFileRecord
};
