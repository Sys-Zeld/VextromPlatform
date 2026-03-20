const { createReportServiceApiRouter } = require("./routes/api");
const { createReportServiceWebRouter } = require("./routes/web");

function registerReportService(app, deps) {
  app.use("/api/report-service", createReportServiceApiRouter(deps));
  app.use("/admin/report-service", createReportServiceWebRouter(deps));
  app.use("/service-report", createReportServiceWebRouter(deps));
}

module.exports = {
  registerReportService
};
