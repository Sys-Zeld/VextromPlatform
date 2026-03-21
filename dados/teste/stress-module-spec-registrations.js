require("dotenv").config();

const db = require("../../module_spec/db");
const repository = require("../../module_spec/src/repositories/simpleRepository");
const {
  readNumberArg,
  runWorkers,
  logWorkerOk,
  logWorkerFail
} = require("./stress-common");

async function runWorker(total, shared, workerId) {
  while (true) {
    const index = shared.next;
    if (index >= total) return;
    shared.next += 1;

    const id = index + 1;
    const stamp = `${Date.now()}_${workerId}_${id}`;
    try {
      const family = await repository.createFamily({
        key: `stress_family_${stamp}`,
        name: `Stress Family ${stamp}`,
        description: "Criado via stress test",
        status: "active"
      });

      const model = await repository.createModel({
        familyId: family.id,
        manufacturer: "Stress Manufacturer",
        brand: "Stress Brand",
        model: `Stress Model ${stamp}`,
        sku: `SKU-${stamp}`,
        description: "Modelo criado via stress test",
        status: "active"
      });

      await repository.createVariant(model.id, {
        variantName: `Stress Variant ${stamp}`,
        variantCode: `VAR-${stamp}`,
        status: "active"
      });

      shared.ok += 1;
      logWorkerOk(workerId, id, total);
    } catch (err) {
      shared.fail += 1;
      logWorkerFail(workerId, id, total, err);
    }
  }
}

async function main() {
  const count = readNumberArg("count", 20, 1, 10000);
  const concurrency = readNumberArg("concurrency", 5, 1, 100);
  const startedAt = Date.now();

  // eslint-disable-next-line no-console
  console.log(`Starting module-spec stress: count=${count} (max 10000), concurrency=${concurrency}`);

  const shared = await runWorkers(count, concurrency, runWorker);

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

