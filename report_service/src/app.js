const { createReportServiceApiRouter } = require("./routes/api");
const { createReportServiceWebRouter } = require("./routes/web");
const { createReportPublicRouter } = require("./routes/public");

function registerReportService(app, deps) {
  app.use("/api/report-service", createReportServiceApiRouter(deps));
  app.use("/admin/report-service", createReportServiceWebRouter(deps));
  app.use("/service-report", createReportServiceWebRouter(deps));
  app.use("/r", createReportPublicRouter(deps));
}

module.exports = {
  registerReportService
};
