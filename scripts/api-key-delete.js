const db = require("../specflow/db");
const { deleteApiKey } = require("../specflow/services/apiKeys");

async function run() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Informe o ID da API key. Ex: npm run api:key:delete -- 3");
  }

  const deleted = await deleteApiKey(id);
  if (!deleted) {
    throw new Error("API key nao encontrada.");
  }

  // eslint-disable-next-line no-console
  console.log(`API key deletada: id=${deleted.id}, name=${deleted.name}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Falha ao deletar API key:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch (_err) {
      // noop
    }
  });

