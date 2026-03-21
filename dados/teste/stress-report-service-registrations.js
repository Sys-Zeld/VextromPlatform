require("dotenv").config();

const db = require("../../report_service/db");
const service = require("../../report_service/src/services/serviceReportService");
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
      const customer = await service.createCustomer({
        name: `Stress Customer ${stamp}`,
        customerType: "others",
        notes: "Criado via stress test"
      });

      await service.createOrder({
        customerId: customer.id,
        title: `Stress Order ${stamp}`,
        description: "OS criada via stress test",
        status: "draft",
        createdBy: "stress-test"
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
  console.log(`Starting report-service stress: count=${count} (max 10000), concurrency=${concurrency}`);

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

