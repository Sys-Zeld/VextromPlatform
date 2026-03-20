const db = require("./db");
const env = require("../specflow/config/env");
const { ensureDatabaseExists } = require("../specflow/db/ensure-database");

async function migrateModuleSpec() {
  await ensureDatabaseExists({
    connectionString: env.databases.moduleSpec.url,
    ssl: env.databases.moduleSpec.ssl
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_families (
      id BIGSERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_equipment_families_status ON equipment_families (status);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_models (
      id BIGSERIAL PRIMARY KEY,
      family_id BIGINT REFERENCES equipment_families(id) ON DELETE RESTRICT,
      category_id BIGINT,
      manufacturer TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE equipment_models ADD COLUMN IF NOT EXISTS family_id BIGINT REFERENCES equipment_families(id) ON DELETE RESTRICT;`);
  await db.query(`ALTER TABLE equipment_models ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE equipment_models ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await db.query(`ALTER TABLE equipment_models ALTER COLUMN category_id DROP NOT NULL;`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_equipment_models_family_status ON equipment_models (family_id, status);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_variants (
      id BIGSERIAL PRIMARY KEY,
      equipment_model_id BIGINT NOT NULL REFERENCES equipment_models(id) ON DELETE CASCADE,
      variant_name TEXT NOT NULL,
      variant_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_equipment_variants_model_status ON equipment_variants (equipment_model_id, status);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_attribute_definitions (
      id BIGSERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      data_type TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      allowed_values_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_equipment_attr_defs_status ON equipment_attribute_definitions (status);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS equipment_variant_attributes (
      id BIGSERIAL PRIMARY KEY,
      equipment_variant_id BIGINT NOT NULL REFERENCES equipment_variants(id) ON DELETE CASCADE,
      attribute_key TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_text TEXT,
      value_number DOUBLE PRECISION,
      value_boolean BOOLEAN,
      value_json JSONB,
      unit TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_equipment_variant_attrs_variant_key ON equipment_variant_attributes (equipment_variant_id, attribute_key);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS profile_filter_mappings (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL,
      field_id BIGINT NOT NULL,
      equipment_attribute_key TEXT NOT NULL,
      operator TEXT NOT NULL DEFAULT 'equals',
      filter_active BOOLEAN NOT NULL DEFAULT TRUE,
      required_match BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (profile_id, field_id, equipment_attribute_key)
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_filter_mappings_profile ON profile_filter_mappings (profile_id, filter_active, sort_order);`);
}

module.exports = {
  migrateModuleSpec
};

if (require.main === module) {
  migrateModuleSpec()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("Module Spec migration complete.");
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Module Spec migration failed:", err.message);
      process.exit(1);
    });
}

