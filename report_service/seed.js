const { migrateServiceReport } = require("./migrate");
const { ensureReportServiceDefaults } = require("./seed-defaults");

async function seedReportService() {
  await migrateServiceReport();
  return ensureReportServiceDefaults();
}

module.exports = {
  seedReportService
};

if (require.main === module) {
  seedReportService()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(
        `Report Service seed concluido. created=${result.total} customer=${result.customer.id} site=${result.site.id} equipment=${result.equipment.id} order=${result.order.id} report=${result.report.id}`
      );
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Report Service seed failed:", err.message);
      process.exit(1);
    });
}
