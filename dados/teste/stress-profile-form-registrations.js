require("dotenv").config();

const db = require("../../specflow/db");
const { createProfile, createFieldInProfile } = require("../../specflow/services/profiles");

function readNumberArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

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
  const count = readNumberArg("count", 20);
  const concurrency = readNumberArg("concurrency", 5);
  const addField = hasFlag("with-field");
  const startedAt = Date.now();
  const shared = { next: 0, ok: 0, fail: 0 };

  // eslint-disable-next-line no-console
  console.log(`Starting stress profile registrations: count=${count}, concurrency=${concurrency}, withField=${addField}`);

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => runWorker(count, shared, i + 1, addField))
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

