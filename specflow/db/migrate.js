const db = require("./index");
const env = require("../config/env");
const { ensureDatabaseExists } = require("./ensure-database");
const { migrateConfigDb } = require("../../configdb/migrate");
const { migrateServiceReport } = require("../../report_service/migrate");
const { migrateModuleSpec } = require("../../module_spec/migrate");

async function migrate() {
  await ensureDatabaseExists({
    connectionString: env.databases.specflow.url,
    ssl: env.databases.specflow.ssl
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS fields (
      id BIGSERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      section TEXT NOT NULL,
      field_type TEXT NOT NULL,
      unit TEXT,
      enum_options JSONB,
      has_default BOOLEAN NOT NULL DEFAULT FALSE,
      default_value JSONB,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS field_profiles (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS field_profile_fields (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES field_profiles(id) ON DELETE CASCADE,
      field_id BIGINT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      is_required BOOLEAN NOT NULL DEFAULT FALSE,
      label TEXT,
      section TEXT,
      field_type TEXT,
      unit TEXT,
      enum_options JSONB,
      has_default BOOLEAN,
      default_value JSONB,
      display_order INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (profile_id, field_id)
    );
  `);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;`);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS label TEXT;`);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS section TEXT;`);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS field_type TEXT;`);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS unit TEXT;`);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS enum_options JSONB;`);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS has_default BOOLEAN;`);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS default_value JSONB;`);
  await db.query(`ALTER TABLE field_profile_fields ADD COLUMN IF NOT EXISTS display_order INTEGER;`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS equipments (
      id BIGSERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      purchaser TEXT NOT NULL DEFAULT '',
      purchaser_contact TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      project_name TEXT NOT NULL DEFAULT '',
      site_name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      profile_id BIGINT REFERENCES field_profiles(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE equipments ADD COLUMN IF NOT EXISTS contact_email TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE equipments ADD COLUMN IF NOT EXISTS contact_phone TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE equipments ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE equipments ADD COLUMN IF NOT EXISTS site_name TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE equipments ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';`);
  await db.query(`
    UPDATE equipments
    SET status = 'send'
    WHERE lower(coalesce(status, '')) = 'sent';
  `);
  await db.query(`
    UPDATE equipments
    SET status = 'draft'
    WHERE lower(coalesce(status, '')) NOT IN ('draft', 'send', 'closed');
  `);
  await db.query(`
    ALTER TABLE equipments
    ADD COLUMN IF NOT EXISTS profile_id BIGINT REFERENCES field_profiles(id) ON DELETE SET NULL;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_field_values (
      id BIGSERIAL PRIMARY KEY,
      equipment_id BIGINT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
      field_id BIGINT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
      value JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (equipment_id, field_id)
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_enabled_fields (
      id BIGSERIAL PRIMARY KEY,
      equipment_id BIGINT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
      field_id BIGINT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (equipment_id, field_id)
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_documents (
      id BIGSERIAL PRIMARY KEY,
      equipment_id BIGINT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      external_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS token_creation_audit (
      id BIGSERIAL PRIMARY KEY,
      equipment_id BIGINT REFERENCES equipments(id) ON DELETE SET NULL,
      channel TEXT NOT NULL DEFAULT 'admin',
      ip_hash TEXT,
      browser_session_hash TEXT,
      user_agent_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_active_hash ON api_keys (is_active, key_hash);`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public_token_links (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      profile_id BIGINT NOT NULL REFERENCES field_profiles(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE public_token_links ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
  await db.query(`ALTER TABLE public_token_links ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await db.query(`ALTER TABLE public_token_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_public_token_links_slug_unique ON public_token_links (slug);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_public_token_links_profile_id ON public_token_links (profile_id);`);

  await migrateConfigDb();
  await migrateServiceReport();

  if (env.moduleSpecEnabled) {
    await migrateModuleSpec();
  }
}

module.exports = {
  migrate
};
