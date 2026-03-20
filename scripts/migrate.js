const { migrate } = require("../specflow/db/migrate");

async function run() {
  await migrate();
  // eslint-disable-next-line no-console
  console.log("Migration complete.");
  process.exit(0);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", err.message);
  process.exit(1);
});

