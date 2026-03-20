const { migrateModuleSpec } = require("./migrate");

async function seedModuleSpec() {
  await migrateModuleSpec();
  return { total: 0 };
}

module.exports = {
  seedModuleSpec
};

if (require.main === module) {
  seedModuleSpec()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(`Module Spec seed concluido. Registros inseridos: ${result.total}.`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Module Spec seed failed:", err.message);
      process.exit(1);
    });
}
