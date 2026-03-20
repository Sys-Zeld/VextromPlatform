const path = require("path");
const ejs = require("ejs");
const { buildPreviewModel } = require("./reportPreviewService");

async function renderReportPreviewHtml(payload) {
  const viewPath = path.join(process.cwd(), "src", "views", "report-service", "preview-document.ejs");
  const model = buildPreviewModel(payload);
  return ejs.renderFile(viewPath, model, {
    async: true
  });
}

module.exports = {
  renderReportPreviewHtml
};
