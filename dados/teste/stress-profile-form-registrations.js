require("dotenv").config();

const db = require("../../specflow/db");
const { createProfile, createFieldInProfile } = require("../../specflow/services/profiles");
const {
  readNumberArg,
  runWorkers,
  logWorkerOk,
  logWorkerFail
} = require("./stress-common");

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function runWorker(total, shared, workerId, addField) {
  while (true) {
    const index = shared.next;
    if (index >= total) return;
    shared.next += 1;

    const id = index + 1;
    try {
      const profile = await createProfile({
        name: `Stress Perfil ${Date.now()}_${workerId}_${id}`,
        fields: []
      });

      if (addField) {
        await createFieldInProfile(profile.id, {
          section: "Stress",
          key: `stress_campo_${workerId}_${id}`,
          label: `Campo stress ${id}`,
          fieldType: "text",
          unit: "",
          enumOptions: [],
          hasDefault: false,
          defaultValue: null
        });
      }

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
  const addField = hasFlag("with-field");
  const startedAt = Date.now();

  // eslint-disable-next-line no-console
  console.log(`Starting stress profile registrations: count=${count}, concurrency=${concurrency}, withField=${addField}`);

  const shared = await runWorkers(count, concurrency, (total, state, workerId) => (
    runWorker(total, state, workerId, addField)
  ));

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

