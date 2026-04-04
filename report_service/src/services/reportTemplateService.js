const path = require("path");
const fs = require("fs");
const ejs = require("ejs");
const { buildPreviewModel } = require("./reportPreviewService");

const REPORT_TEMPLATE_DEFINITIONS = [
  {
    key: "modern",
    name: "Modern",
    fileName: "document-template.ejs"
  },
  {
    key: "classic",
    name: "Classic",
    fileName: "document-template-classic.ejs"
  }
];

function getReportTemplateOptions() {
  return REPORT_TEMPLATE_DEFINITIONS.map((item) => ({
    key: item.key,
    name: item.name
  }));
}

function normalizeReportTemplateKey(input) {
  const normalized = String(input || "").trim().toLowerCase();
  const exists = REPORT_TEMPLATE_DEFINITIONS.some((item) => item.key === normalized);
  return exists ? normalized : REPORT_TEMPLATE_DEFINITIONS[0].key;
}

function resolveTemplatePath(templateKey) {
  const normalizedKey = normalizeReportTemplateKey(templateKey);
  const template = REPORT_TEMPLATE_DEFINITIONS.find((item) => item.key === normalizedKey) || REPORT_TEMPLATE_DEFINITIONS[0];

  const candidates = [
    path.resolve(__dirname, "..", "..", "templates", "report", template.fileName),
    path.join(process.cwd(), "report_service", "templates", "report", template.fileName),
    path.join(process.cwd(), "templates", "report", template.fileName)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

async function renderReportPreviewHtml(payload, options = {}) {
  const templateKey = normalizeReportTemplateKey(
    options.templateKey || (options.reportConfig && options.reportConfig.templateKey)
  );
  const viewPath = resolveTemplatePath(templateKey);
  const model = buildPreviewModel(payload, {
    reportConfig: options.reportConfig || null,
    templateKey
  });
  return ejs.renderFile(viewPath, model, {
    async: true
  });
}

module.exports = {
  renderReportPreviewHtml,
  getReportTemplateOptions,
  normalizeReportTemplateKey
};
