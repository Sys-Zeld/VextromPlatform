require("dotenv").config();

const db = require("../../specflow/db");
const { createEquipment } = require("../../specflow/services/equipments");

function readNumberArg(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  if (!Number.isInteger(value) || value < min) return fallback;
  return Math.min(value, max);
}

async function runWorker(total, shared, workerId) {
  while (true) {
    const index = shared.next;
    if (index >= total) return;
    shared.next += 1;

    const id = index + 1;
    try {
      await createEquipment({
        purchaser: `Cliente Stress ${id}`,
        purchaserContact: `Contato ${id}`,
        contactEmail: `stress.cliente.${id}@example.com`,
        contactPhone: `+55 11 90000-${String(id).padStart(4, "0")}`,
        projectName: `Projeto Stress ${id}`,
        siteName: `Site ${id}`,
        address: `Endereco ${id}`
      });
      shared.ok += 1;
      // eslint-disable-next-line no-console
      console.log(`[worker ${workerId}] OK ${id}/${total}`);
    } catch (err) {
      shared.fail += 1;
      // eslint-disable-next-line no-console
      console.error(`[worker ${workerId}] FAIL ${id}/${total}: ${err.message}`);
    }
  }
}

async function main() {
  const count = readNumberArg("count", 20, 1, 10000);
  const concurrency = readNumberArg("concurrency", 5, 1, 100);
  const startedAt = Date.now();
  const shared = { next: 0, ok: 0, fail: 0 };

  // eslint-disable-next-line no-console
  console.log(`Starting stress client registrations: count=${count} (max 10000), concurrency=${concurrency}`);

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => runWorker(count, shared, i + 1))
  );

  const durationMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(`Finished. success=${shared.ok}, fail=${shared.fail}, durationMs=${durationMs}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Stress test failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });

