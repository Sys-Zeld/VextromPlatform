const db = require("../specflow/db");
const { revokeApiKey } = require("../specflow/services/apiKeys");

async function run() {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Informe o ID da API key. Ex: npm run api:key:revoke -- 3");
  }

  const revoked = await revokeApiKey(id);
  if (!revoked) {
    throw new Error("API key nao encontrada.");
  }

  // eslint-disable-next-line no-console
  console.log(`API key revogada: id=${revoked.id}, name=${revoked.name}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Falha ao revogar API key:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch (_err) {
      // noop
    }
  });

