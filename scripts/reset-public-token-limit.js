const db = require("../specflow/db");

async function run() {
  const result = await db.query(
    "DELETE FROM token_creation_audit WHERE channel = 'public'"
  );
  // eslint-disable-next-line no-console
  console.log(`Limite publico resetado. Registros removidos: ${result.rowCount || 0}.`);
  process.exit(0);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha ao resetar limite publico:", err.message);
  process.exit(1);
});

