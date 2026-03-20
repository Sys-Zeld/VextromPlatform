const db = require("../specflow/db");

async function run() {
  await db.query("BEGIN");
  try {
    await db.query("DROP SCHEMA IF EXISTS public CASCADE;");
    await db.query("CREATE SCHEMA public;");
    await db.query("GRANT ALL ON SCHEMA public TO CURRENT_USER;");
    await db.query("GRANT ALL ON SCHEMA public TO public;");
    await db.query("COMMIT");
    // eslint-disable-next-line no-console
    console.log("Schema public recriado com sucesso. Banco pronto para restore limpo.");
    process.exit(0);
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha ao recriar schema public:", err.message);
  process.exit(1);
});

