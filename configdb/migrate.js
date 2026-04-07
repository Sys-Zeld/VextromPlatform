const db = require("./db");
const env = require("../specflow/config/env");
const specflowDb = require("../specflow/db");
const { ensureDatabaseExists } = require("../specflow/db/ensure-database");

async function migrateBackupFilesFromSpecflowDb() {
  if (env.databases.specflow.url === env.databases.config.url) return;

  // Verifica se tabela existe no specflow
  const tableCheck = await specflowDb.query(
    "SELECT to_regclass('public.backup_files')::text AS table_name"
  );
  if (!tableCheck.rows[0] || !tableCheck.rows[0].table_name) return;

  // Migra apenas se configdb ainda estiver vazio
  const destCount = await db.query("SELECT COUNT(*)::int AS count FROM backup_files");
  if (Number(destCount.rows[0]?.count) > 0) return;

  const rows = await specflowDb.query("SELECT * FROM backup_files ORDER BY id ASC");
  if (!rows.rows.length) return;

  await db.query("BEGIN");
  try {
    for (const row of rows.rows) {
      await db.query(
        `INSERT INTO backup_files (file_name, file_path, folder_path, size_bytes, backup_timestamp, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (file_path) DO NOTHING`,
        [row.file_name, row.file_path, row.folder_path, row.size_bytes,
          row.backup_timestamp, row.created_at, row.updated_at]
      );
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }

  // Remove a tabela do specflow apos migrar com sucesso
  await specflowDb.query("DROP TABLE IF EXISTS backup_files CASCADE;");
}

async function readLegacySpecflowAdminUsers() {
  if (env.databases.specflow.url === env.databases.config.url) return [];

  const tableCheck = await specflowDb.query(
    "SELECT to_regclass('public.admin_users')::text AS table_name"
  );
  if (!tableCheck.rows[0] || !tableCheck.rows[0].table_name) return [];

  try {
    const result = await specflowDb.query(`
      SELECT id, username, role, module_access, ui_font, salt, password_hash, created_at, updated_at
      FROM admin_users
      ORDER BY created_at ASC, username ASC
    `);
    return result.rows;
  } catch (err) {
    if (err && err.code === "42703") {
      const fallback = await specflowDb.query(`
        SELECT id, username, role, module_access, 'inter'::text AS ui_font, salt, password_hash, created_at, updated_at
        FROM admin_users
        ORDER BY created_at ASC, username ASC
      `);
      return fallback.rows;
    }
    throw err;
  }
}

async function migrateAdminUsersFromSpecflowDb() {
  const targetCountResult = await db.query("SELECT COUNT(*)::int AS count FROM admin_users");
  const targetCount = Number(targetCountResult.rows[0]?.count || 0);
  if (targetCount > 0) return;

  const legacyRows = await readLegacySpecflowAdminUsers();
  if (!legacyRows.length) return;

  await db.query("BEGIN");
  try {
    for (const row of legacyRows) {
      await db.query(
        `
          INSERT INTO admin_users (id, username, role, module_access, ui_font, salt, password_hash, created_at, updated_at)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
          ON CONFLICT (username) DO NOTHING
        `,
        [
          row.id,
          row.username,
          row.role,
          JSON.stringify(row.module_access || ["specflow", "module-spec", "report-service"]),
          String(row.ui_font || "inter").trim().toLowerCase() || "inter",
          row.salt,
          row.password_hash,
          row.created_at || new Date().toISOString(),
          row.updated_at || row.created_at || new Date().toISOString()
        ]
      );
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

async function migrateConfigDb() {
  await ensureDatabaseExists({
    connectionString: env.databases.config.url,
    ssl: env.databases.config.ssl
  });

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
  await db.query(`
    UPDATE admin_users
    SET ui_font = lower(trim(coalesce(ui_font, 'inter')))
    WHERE ui_font IS NULL
      OR trim(coalesce(ui_font, '')) = ''
      OR lower(trim(coalesce(ui_font, ''))) NOT IN ('inter', 'manrope', 'nunito', 'source-sans-3', 'ibm-plex-sans');
  `);
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'admin_users_ui_font_check'
      ) THEN
        ALTER TABLE admin_users
        ADD CONSTRAINT admin_users_ui_font_check
        CHECK (ui_font IN ('inter', 'manrope', 'nunito', 'source-sans-3', 'ibm-plex-sans'));
      END IF;
    END
    $$;
  `);
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_username_unique ON admin_users (username);");

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
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_files_path_unique ON backup_files (file_path);`);

  await migrateAdminUsersFromSpecflowDb();
  await migrateBackupFilesFromSpecflowDb();
}

module.exports = {
  migrateConfigDb
};

if (require.main === module) {
  migrateConfigDb()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("Config DB migration complete.");
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Config DB migration failed:", err.message);
      process.exit(1);
    });
}
