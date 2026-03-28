const db = require("../../db");
const env = require("../../../specflow/config/env");
const { getReportTemplateOptions, normalizeReportTemplateKey } = require("./reportTemplateService");

const REPORT_CONFIG_KEYS = {
  logoVextrom: "report.preview.logo.vextrom",
  logoChloride: "report.preview.logo.chloride",
  defaultTemplate: "report.preview.template.default"
};

async function getSettingsMap(keys) {
  const result = await db.query(
    `
      SELECT key, value
      FROM service_report_app_settings
      WHERE key = ANY($1::text[])
    `,
    [keys]
  );
  return result.rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

async function upsertSetting(key, value) {
  await db.query(
    `
      INSERT INTO service_report_app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [key, String(value || "")]
  );
}

async function getReportConfigSettings() {
  const keys = Object.values(REPORT_CONFIG_KEYS);
  const settings = await getSettingsMap(keys);
  const logoVextrom = String(settings[REPORT_CONFIG_KEYS.logoVextrom] || env.serviceReport?.logoVextrom || process.env.SERVICE_REPORT_LOGO_VEXTROM || "/public/img/logo-vextrom.svg").trim();
  const logoChloride = String(settings[REPORT_CONFIG_KEYS.logoChloride] || env.serviceReport?.logoChloride || process.env.SERVICE_REPORT_LOGO_CHLORIDE || "").trim();
  const templateKey = normalizeReportTemplateKey(settings[REPORT_CONFIG_KEYS.defaultTemplate]);

  return {
    logoVextrom,
    logoChloride,
    templateKey,
    templateOptions: getReportTemplateOptions()
  };
}

async function saveReportConfigSettings(payload = {}) {
  const logoVextrom = String(payload.logoVextrom || "").trim();
  const logoChloride = String(payload.logoChloride || "").trim();
  const templateKey = normalizeReportTemplateKey(payload.templateKey);

  await Promise.all([
    upsertSetting(REPORT_CONFIG_KEYS.logoVextrom, logoVextrom),
    upsertSetting(REPORT_CONFIG_KEYS.logoChloride, logoChloride),
    upsertSetting(REPORT_CONFIG_KEYS.defaultTemplate, templateKey)
  ]);

  return {
    logoVextrom,
    logoChloride,
    templateKey
  };
}

module.exports = {
  getReportConfigSettings,
  saveReportConfigSettings
};
