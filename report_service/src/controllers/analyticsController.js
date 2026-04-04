const path = require("path");
const ejs = require("ejs");
const analyticsService = require("../services/analyticsService");
const { buildAnalyticsPdfBufferFromHtml } = require("../services/serviceReportPdfService");

function createAnalyticsWebController(deps) {
  const sanitizeInput = deps.sanitizeInput;

  function collectFilters(req) {
    return {
      date_from: sanitizeInput(req.query.date_from || req.body?.date_from),
      date_to: sanitizeInput(req.query.date_to || req.body?.date_to),
      customer_id: sanitizeInput(req.query.customer_id || req.body?.customer_id),
      site_id: sanitizeInput(req.query.site_id || req.body?.site_id),
      technician_id: sanitizeInput(req.query.technician_id || req.body?.technician_id),
      order_status: sanitizeInput(req.query.order_status || req.body?.order_status)
    };
  }

  async function renderAnalyticsPdfHtml(model) {
    const templatePath = path.resolve(__dirname, "..", "..", "templates", "report", "analytics-report.ejs");
    return ejs.renderFile(templatePath, model, { async: true });
  }

  return {
    async dashboard(req, res) {
      const payload = await analyticsService.getDashboardPayload(collectFilters(req));
      return res.render("report-service/analytics-dashboard", {
        pageTitle: "Service Report - Relatório/Dashboard",
        dashboard: payload,
        filters: payload.filters,
        options: payload.options,
        csrfToken: req.csrfToken()
      });
    },

    async dashboardData(req, res) {
      const payload = await analyticsService.getDashboardPayload(collectFilters(req));
      return res.status(200).json({ ok: true, data: payload });
    },

    async exportPdf(req, res) {
      const payload = await analyticsService.getDashboardPayload(collectFilters(req));
      const html = await renderAnalyticsPdfHtml({
        pageTitle: "Relatório Dashboard",
        generatedAt: new Date(),
        dashboard: payload,
        filters: payload.filters
      });
      const pdfBuffer = await buildAnalyticsPdfBufferFromHtml(html);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=report-service-dashboard-${stamp}.pdf`);
      return res.send(pdfBuffer);
    }
  };
}

module.exports = {
  createAnalyticsWebController
};

