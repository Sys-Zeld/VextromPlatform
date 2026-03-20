const db = require("../specflow/db");

async function run() {
  await db.query("BEGIN");
  try {
    await db.query(`
      TRUNCATE TABLE
        equipment_documents,
        equipment_enabled_fields,
        equipment_field_values,
        api_keys,
        field_profile_fields,
        equipments,
        field_profiles,
        fields
      RESTART IDENTITY CASCADE;
    `);
    await db.query("COMMIT");
    // eslint-disable-next-line no-console
    console.log("Banco limpo com sucesso.");
    process.exit(0);
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha ao limpar banco:", err.message);
  process.exit(1);
});

