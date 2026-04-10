const db = require("./db");
const env = require("../specflow/config/env");
const { ensureDatabaseExists } = require("../specflow/db/ensure-database");

async function migrateServiceReport() {
  await ensureDatabaseExists({
    connectionString: env.databases.reportService.url,
    ssl: env.databases.reportService.ssl
  });

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_customers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      customer_type TEXT NOT NULL DEFAULT 'others',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_customer_contacts (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES service_report_customers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_customer_sites (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES service_report_customers(id) ON DELETE CASCADE,
      site_name TEXT NOT NULL,
      site_code TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`ALTER TABLE service_report_customer_sites ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE service_report_customer_sites ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_equipments (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES service_report_customers(id) ON DELETE SET NULL,
      site_id BIGINT REFERENCES service_report_customer_sites(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      year_of_manufacture TEXT NOT NULL DEFAULT '',
      serial_number TEXT NOT NULL DEFAULT '',
      rated_ac_input_voltage TEXT NOT NULL DEFAULT '',
      input_frequency TEXT NOT NULL DEFAULT '',
      rated_dc_voltage TEXT NOT NULL DEFAULT '',
      rated_ac_output_voltage TEXT NOT NULL DEFAULT '',
      output_frequency TEXT NOT NULL DEFAULT '',
      degree_of_protection TEXT NOT NULL DEFAULT '',
      main_label TEXT NOT NULL DEFAULT '',
      dt_number TEXT NOT NULL DEFAULT '',
      tag_number TEXT NOT NULL DEFAULT '',
      manufacturer TEXT NOT NULL DEFAULT '',
      model_family TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_equipments_customer_id ON service_report_equipments (customer_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_equipments_site_id ON service_report_equipments (site_id);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_spare_parts (
      id BIGSERIAL PRIMARY KEY,
      description TEXT NOT NULL,
      manufacturer TEXT NOT NULL DEFAULT '',
      equipment_model TEXT NOT NULL DEFAULT '',
      part_number TEXT NOT NULL DEFAULT '',
      lead_time TEXT NOT NULL DEFAULT '',
      is_obsolete BOOLEAN NOT NULL DEFAULT FALSE,
      replaced_by_part_number TEXT NOT NULL DEFAULT '',
      equipment_family TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE service_report_spare_parts ADD COLUMN IF NOT EXISTS equipment_model TEXT NOT NULL DEFAULT '';`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_spare_parts_part_number ON service_report_spare_parts (part_number);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_spare_parts_family ON service_report_spare_parts (equipment_family);`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_spare_parts_pn_unique ON service_report_spare_parts (LOWER(part_number)) WHERE part_number <> '';`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_equipment_spare_parts (
      equipment_id BIGINT NOT NULL REFERENCES service_report_equipments(id) ON DELETE CASCADE,
      spare_part_id BIGINT NOT NULL REFERENCES service_report_spare_parts(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (equipment_id, spare_part_id)
    );
  `);
  await db.query(`ALTER TABLE service_report_equipment_spare_parts ADD COLUMN IF NOT EXISTS quantity INTEGER;`);
  await db.query(`UPDATE service_report_equipment_spare_parts SET quantity = 1 WHERE quantity IS NULL OR quantity <= 0;`);
  await db.query(`ALTER TABLE service_report_equipment_spare_parts ALTER COLUMN quantity SET DEFAULT 1;`);
  await db.query(`ALTER TABLE service_report_equipment_spare_parts ALTER COLUMN quantity SET NOT NULL;`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_eq_spare_parts_equipment_id ON service_report_equipment_spare_parts (equipment_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_eq_spare_parts_spare_part_id ON service_report_equipment_spare_parts (spare_part_id);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_orders (
      id BIGSERIAL PRIMARY KEY,
      service_order_code TEXT NOT NULL UNIQUE,
      year INTEGER NOT NULL,
      customer_id BIGINT NOT NULL REFERENCES service_report_customers(id) ON DELETE RESTRICT,
      site_id BIGINT REFERENCES service_report_customer_sites(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      opening_date DATE,
      closing_date DATE,
      created_by TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_orders_customer_id ON service_report_orders (customer_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_orders_site_id ON service_report_orders (site_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_orders_status ON service_report_orders (status);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_order_equipments (
      id BIGSERIAL PRIMARY KEY,
      service_order_id BIGINT NOT NULL REFERENCES service_report_orders(id) ON DELETE CASCADE,
      equipment_id BIGINT NOT NULL REFERENCES service_report_equipments(id) ON DELETE CASCADE,
      ref_id INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (service_order_id, equipment_id)
    );
  `);
  await db.query(`ALTER TABLE service_report_order_equipments ADD COLUMN IF NOT EXISTS ref_id INTEGER;`);
  await db.query(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY service_order_id ORDER BY id ASC) AS seq
      FROM service_report_order_equipments
    )
    UPDATE service_report_order_equipments oe
    SET ref_id = ranked.seq
    FROM ranked
    WHERE oe.id = ranked.id AND (oe.ref_id IS NULL OR oe.ref_id <= 0);
  `);
  await db.query(`ALTER TABLE service_report_order_equipments ALTER COLUMN ref_id SET NOT NULL;`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_order_equipments_ref_id ON service_report_order_equipments (service_order_id, ref_id);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_timesheet_entries (
      id BIGSERIAL PRIMARY KEY,
      service_order_id BIGINT NOT NULL REFERENCES service_report_orders(id) ON DELETE CASCADE,
      activity_date DATE NOT NULL,
      check_in_base TEXT NOT NULL DEFAULT '',
      check_in_client TEXT NOT NULL DEFAULT '',
      check_out_client TEXT NOT NULL DEFAULT '',
      check_out_base TEXT NOT NULL DEFAULT '',
      technician_name TEXT NOT NULL DEFAULT '',
      worked_hours NUMERIC(8,2),
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_timesheet_order_id ON service_report_timesheet_entries (service_order_id);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_daily_logs (
      id BIGSERIAL PRIMARY KEY,
      service_order_id BIGINT NOT NULL REFERENCES service_report_orders(id) ON DELETE CASCADE,
      activity_date DATE NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_daily_logs_order_id ON service_report_daily_logs (service_order_id);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_reports (
      id BIGSERIAL PRIMARY KEY,
      service_order_id BIGINT NOT NULL REFERENCES service_report_orders(id) ON DELETE CASCADE UNIQUE,
      report_number TEXT NOT NULL UNIQUE,
      revision TEXT NOT NULL DEFAULT 'A',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      issue_date DATE,
      document_language TEXT NOT NULL DEFAULT 'pt',
      template_name TEXT NOT NULL DEFAULT 'service-report-default',
      template_version TEXT NOT NULL DEFAULT '1.0.0',
      last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      prepared_by TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL DEFAULT '',
      pdf_path TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE service_report_reports ADD COLUMN IF NOT EXISTS document_language TEXT NOT NULL DEFAULT 'pt';`);
  await db.query(`
    UPDATE service_report_reports
    SET document_language = 'pt'
    WHERE trim(COALESCE(document_language, '')) = '';
  `);
  await db.query(`ALTER TABLE service_report_reports ADD COLUMN IF NOT EXISTS template_name TEXT NOT NULL DEFAULT 'service-report-default';`);
  await db.query(`ALTER TABLE service_report_reports ADD COLUMN IF NOT EXISTS template_version TEXT NOT NULL DEFAULT '1.0.0';`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_sections (
      id BIGSERIAL PRIMARY KEY,
      service_report_id BIGINT NOT NULL REFERENCES service_report_reports(id) ON DELETE CASCADE,
      section_key TEXT NOT NULL,
      section_title TEXT NOT NULL,
      section_title_delta_json JSONB NOT NULL DEFAULT '{"ops":[{"insert":"\\n"}]}'::jsonb,
      section_title_html TEXT NOT NULL DEFAULT '',
      section_title_text TEXT NOT NULL DEFAULT '',
      content_delta_json JSONB NOT NULL DEFAULT '{"ops":[{"insert":"\\n"}]}'::jsonb,
      content_html TEXT NOT NULL DEFAULT '',
      content_text TEXT NOT NULL DEFAULT '',
      image_left_path TEXT NOT NULL DEFAULT '',
      image_right_path TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_rich_text BOOLEAN NOT NULL DEFAULT FALSE,
      is_visible BOOLEAN NOT NULL DEFAULT TRUE,
      is_locked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (service_report_id, section_key)
    );
  `);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS section_title_delta_json JSONB NOT NULL DEFAULT '{"ops":[{"insert":"\\n"}]}'::jsonb;`);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS section_title_html TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS section_title_text TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS content_delta_json JSONB NOT NULL DEFAULT '{"ops":[{"insert":"\\n"}]}'::jsonb;`);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS content_html TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS content_text TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS image_left_path TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS image_right_path TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE;`);
  await db.query(`ALTER TABLE service_report_sections ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.query(`
    UPDATE service_report_sections
    SET section_title_text = trim(COALESCE(section_title_text, ''))
    WHERE trim(COALESCE(section_title_text, '')) = '' AND trim(COALESCE(section_title, '')) <> '';
  `);
  await db.query(`
    UPDATE service_report_sections
    SET section_title_html = '<span>' || replace(trim(section_title_text), '<', '&lt;') || '</span>'
    WHERE trim(COALESCE(section_title_html, '')) = '' AND trim(COALESCE(section_title_text, '')) <> '';
  `);
  await db.query(`
    UPDATE service_report_sections
    SET section_title_delta_json = jsonb_build_object(
      'ops',
      jsonb_build_array(
        jsonb_build_object(
          'insert',
          CASE
            WHEN trim(COALESCE(section_title_text, '')) <> '' THEN trim(section_title_text) || E'\\n'
            ELSE E'\\n'
          END
        )
      )
    )
    WHERE
      section_title_delta_json IS NULL
      OR jsonb_typeof(section_title_delta_json) <> 'object'
      OR NOT (section_title_delta_json ? 'ops');
  `);
  await db.query(`
    UPDATE service_report_sections
    SET content_delta_json = jsonb_build_object(
      'ops',
      jsonb_build_array(
        jsonb_build_object(
          'insert',
          CASE
            WHEN trim(COALESCE(content_text, '')) <> '' THEN trim(content_text) || E'\\n'
            ELSE E'\\n'
          END
        )
      )
    )
    WHERE
      content_delta_json IS NULL
      OR jsonb_typeof(content_delta_json) <> 'object'
      OR NOT (content_delta_json ? 'ops');
  `);
  await db.query(`
    UPDATE service_report_sections
    SET content_html = '<p>' || replace(trim(content_text), '<', '&lt;') || '</p>'
    WHERE trim(COALESCE(content_html, '')) = '' AND trim(COALESCE(content_text, '')) <> '';
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_component_items (
      id BIGSERIAL PRIMARY KEY,
      service_report_id BIGINT NOT NULL REFERENCES service_report_reports(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      equipment_id BIGINT REFERENCES service_report_equipments(id) ON DELETE SET NULL,
      quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
      description TEXT NOT NULL DEFAULT '',
      part_number TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_instruments (
      id BIGSERIAL PRIMARY KEY,
      service_report_id BIGINT NOT NULL REFERENCES service_report_reports(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      serial_number TEXT NOT NULL DEFAULT '',
      calibration_due_date DATE,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_technicians (
      id BIGSERIAL PRIMARY KEY,
      service_report_id BIGINT NOT NULL REFERENCES service_report_reports(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      is_lead BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_signatures (
      id BIGSERIAL PRIMARY KEY,
      service_report_id BIGINT NOT NULL REFERENCES service_report_reports(id) ON DELETE CASCADE,
      signer_type TEXT NOT NULL,
      signer_name TEXT NOT NULL,
      signer_role TEXT NOT NULL DEFAULT '',
      signer_company TEXT NOT NULL DEFAULT '',
      signature_data TEXT NOT NULL DEFAULT '',
      signature_file_path TEXT NOT NULL DEFAULT '',
      signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_signatures_report_id ON service_report_signatures (service_report_id);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_images (
      id BIGSERIAL PRIMARY KEY,
      service_report_id BIGINT NOT NULL REFERENCES service_report_reports(id) ON DELETE CASCADE,
      ref_id INTEGER,
      section_key TEXT NOT NULL DEFAULT '',
      daily_log_id BIGINT REFERENCES service_report_daily_logs(id) ON DELETE SET NULL,
      file_path TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE service_report_images ADD COLUMN IF NOT EXISTS ref_id INTEGER;`);
  await db.query(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY service_report_id ORDER BY id ASC) AS seq
      FROM service_report_images
    )
    UPDATE service_report_images si
    SET ref_id = ranked.seq
    FROM ranked
    WHERE si.id = ranked.id AND (si.ref_id IS NULL OR si.ref_id <= 0);
  `);
  await db.query(`ALTER TABLE service_report_images ALTER COLUMN ref_id SET NOT NULL;`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_images_ref_id ON service_report_images (service_report_id, ref_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_images_report_id ON service_report_images (service_report_id);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_global_technicians (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      is_lead BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_global_instruments (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      serial_number TEXT NOT NULL DEFAULT '',
      calibration_due_date DATE,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_order_technicians (
      order_id BIGINT NOT NULL REFERENCES service_report_orders(id) ON DELETE CASCADE,
      technician_id BIGINT NOT NULL REFERENCES service_report_global_technicians(id) ON DELETE CASCADE,
      PRIMARY KEY (order_id, technician_id)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_order_instruments (
      order_id BIGINT NOT NULL REFERENCES service_report_orders(id) ON DELETE CASCADE,
      instrument_id BIGINT NOT NULL REFERENCES service_report_global_instruments(id) ON DELETE CASCADE,
      PRIMARY KEY (order_id, instrument_id)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_report_sign_requests (
      id BIGSERIAL PRIMARY KEY,
      service_report_id BIGINT NOT NULL REFERENCES service_report_reports(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      signer_name TEXT NOT NULL DEFAULT '',
      signer_email TEXT NOT NULL DEFAULT '',
      signer_role TEXT NOT NULL DEFAULT '',
      signer_company TEXT NOT NULL DEFAULT '',
      signature_data TEXT NOT NULL DEFAULT '',
      signed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
      ip_address TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_sign_requests_report_id ON service_report_sign_requests (service_report_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_sr_sign_requests_token ON service_report_sign_requests (token);`);

  await seedServiceReportEquipment();
  await seedServiceReportSample();
}

async function seedServiceReportEquipment() {
  return;
}

async function seedServiceReportSample() {
  return;
}

module.exports = {
  migrateServiceReport
};

if (require.main === module) {
  migrateServiceReport()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("Report Service migration complete.");
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Report Service migration failed:", err.message);
      process.exit(1);
    });
}
