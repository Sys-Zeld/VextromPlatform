/**
 * Limpa todo o cadastro de spare parts (service_report_spare_parts) e
 * os vínculos com equipamentos (service_report_equipment_spare_parts).
 *
 * Uso: npm run report-service:spare-parts:clear
 *
 * ATENÇÃO: operação irreversível. Todos os spare parts e vínculos
 * com equipamentos serão removidos permanentemente.
 */

const readline = require("readline");
const db = require("../report_service/db");

async function run() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  await new Promise((resolve, reject) => {
    rl.question(
      "\n⚠️  ATENÇÃO: Esta operação irá apagar TODOS os spare parts cadastrados e seus vínculos.\nDigite 'CONFIRMAR' para continuar: ",
      (answer) => {
        rl.close();
        if (answer.trim() !== "CONFIRMAR") {
          // eslint-disable-next-line no-console
          console.log("Operação cancelada.");
          process.exit(0);
        }
        resolve();
      }
    );
    rl.on("error", reject);
  });

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const links = await client.query("SELECT COUNT(*)::int AS total FROM service_report_equipment_spare_parts");
    const parts = await client.query("SELECT COUNT(*)::int AS total FROM service_report_spare_parts");

    await client.query("TRUNCATE TABLE service_report_equipment_spare_parts RESTART IDENTITY CASCADE");
    await client.query("TRUNCATE TABLE service_report_spare_parts RESTART IDENTITY CASCADE");

    await client.query("COMMIT");

    // eslint-disable-next-line no-console
    console.log(
      `\n✅ Limpeza concluída.\n` +
      `   Spare parts removidos : ${parts.rows[0].total}\n` +
      `   Vínculos removidos    : ${links.rows[0].total}\n`
    );
    process.exit(0);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\n❌ Falha ao limpar spare parts:", err.message);
  process.exit(1);
});
