const env = require("../specflow/config/env");
const { seedSpecflow } = require("../specflow/seed");
const { seedModuleSpec } = require("../module_spec/seed");
const { seedReportService } = require("../report_service/seed");

async function run() {
  const specflow = await seedSpecflow();
  const reportService = await seedReportService();
  let moduleSpec = null;

  if (env.moduleSpecEnabled) {
    moduleSpec = await seedModuleSpec();
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      `Seed concluido:`,
      `specflow=${specflow.total}`,
      `report_service=${reportService.total}`,
      `module_spec=${moduleSpec ? moduleSpec.total : "skipped (MODULE_SPEC_ENABLED=false)"}`
    ].join(" ")
  );
  process.exit(0);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Seed failed:", err.message);
  process.exit(1);
});

