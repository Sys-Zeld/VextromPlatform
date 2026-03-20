const db = require("../specflow/db");
const { listApiKeys } = require("../specflow/services/apiKeys");

async function run() {
  const keys = await listApiKeys();
  if (!keys.length) {
    // eslint-disable-next-line no-console
    console.log("Nenhuma API key cadastrada.");
    return;
  }

  // eslint-disable-next-line no-console
  console.log("API keys cadastradas:");
  keys.forEach((item) => {
    // eslint-disable-next-line no-console
    console.log(
      [
        `id=${item.id}`,
        `name=${item.name}`,
        `prefix=${item.keyPrefix}`,
        `active=${item.isActive}`,
        `scopes=${(item.scopes || []).join(",")}`,
        `expires_at=${item.expiresAt || "-"}`,
        `last_used_at=${item.lastUsedAt || "-"}`
      ].join(" | ")
    );
  });
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Falha ao listar API keys:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch (_err) {
      // noop
    }
  });

