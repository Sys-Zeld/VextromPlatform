const db = require("../specflow/db");
const {
  getEquipmentByToken,
  updateEquipmentStatus
} = require("../specflow/services/equipments");

function parseArgValue(flagName) {
  const prefix = `${flagName}=`;
  const matched = process.argv.find((arg) => arg.startsWith(prefix));
  return matched ? String(matched.slice(prefix.length)).trim() : "";
}

async function run() {
  const tokenRaw = parseArgValue("--token");

  if (!tokenRaw) {
    throw new Error("Informe --token=<token>. Ex: npm run token:set-sent -- --token=abc123");
  }

  const equipment = await getEquipmentByToken(tokenRaw);

  if (!equipment) {
    throw new Error("Token/equipamento nao encontrado.");
  }

  await updateEquipmentStatus(equipment.id, "sent");

  // eslint-disable-next-line no-console
  console.log(`Status atualizado para sent: id=${equipment.id}, token=${equipment.token}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Falha ao atualizar status:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch (_err) {
      // noop
    }
  });

