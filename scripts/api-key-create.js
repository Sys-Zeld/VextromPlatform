const env = require("../specflow/config/env");
const db = require("../specflow/db");
const { createApiKey } = require("../specflow/services/apiKeys");

function parseArgs(argv) {
  const args = {
    name: "",
    scopes: [],
    ttlDays: env.apiKeys.defaultTtlDays
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--name" && argv[i + 1]) {
      args.name = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg === "--scopes" && argv[i + 1]) {
      args.scopes = String(argv[i + 1])
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === "--ttl-days" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) args.ttlDays = Math.floor(parsed);
      i += 1;
    }
  }

  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) {
    throw new Error("Informe --name para criar a API key.");
  }
  if (!args.scopes.length) {
    throw new Error("Informe --scopes com ao menos um escopo. Ex: fields:read,spec:read");
  }

  const expiresAt = new Date(Date.now() + args.ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const created = await createApiKey({
    name: args.name,
    scopes: args.scopes,
    expiresAt
  });

  // eslint-disable-next-line no-console
  console.log("API key criada com sucesso.");
  // eslint-disable-next-line no-console
  console.log(`id: ${created.record.id}`);
  // eslint-disable-next-line no-console
  console.log(`name: ${created.record.name}`);
  // eslint-disable-next-line no-console
  console.log(`scopes: ${created.record.scopes.join(",")}`);
  // eslint-disable-next-line no-console
  console.log(`expires_at: ${created.record.expiresAt}`);
  // eslint-disable-next-line no-console
  console.log(`api_key: ${created.key}`);
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Falha ao criar API key:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch (_err) {
      // noop
    }
  });

