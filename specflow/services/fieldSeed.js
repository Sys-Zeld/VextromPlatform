const db = require("../db");
const { FIELDS_SEED, SECTION_ORDER } = require("../schema/annexD.fields.seed");

async function seedAnnexDFields(options = {}) {
  const overwrite = Boolean(options.overwrite);
  const client = await db.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (let i = 0; i < FIELDS_SEED.length; i += 1) {
      const item = FIELDS_SEED[i];
      const sectionOrder = SECTION_ORDER.indexOf(item.section);
      const displayOrder = sectionOrder < 0 ? i : sectionOrder * 1000 + i;
      const query = overwrite
        ? `
            INSERT INTO fields (key, label, section, field_type, unit, enum_options, has_default, default_value, display_order, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, NOW(), NOW())
            ON CONFLICT (key) DO UPDATE SET
              label = EXCLUDED.label,
              section = EXCLUDED.section,
              field_type = EXCLUDED.field_type,
              unit = EXCLUDED.unit,
              enum_options = EXCLUDED.enum_options,
              has_default = EXCLUDED.has_default,
              default_value = EXCLUDED.default_value,
              display_order = EXCLUDED.display_order,
              updated_at = NOW()
          `
        : `
            INSERT INTO fields (key, label, section, field_type, unit, enum_options, has_default, default_value, display_order, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, NOW(), NOW())
            ON CONFLICT (key) DO NOTHING
          `;

      await client.query(query, [
        item.key,
        item.label,
        item.section,
        item.fieldType,
        item.unit || null,
        item.enumOptions ? JSON.stringify(item.enumOptions) : null,
        Boolean(item.hasDefault),
        item.hasDefault ? JSON.stringify(item.defaultValue) : null,
        displayOrder
      ]);
      inserted += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { total: inserted };
}

module.exports = {
  seedAnnexDFields
};
