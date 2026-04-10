const db = require("../../db");
const env = require("../../../specflow/config/env");
const { getReportTemplateOptions, normalizeReportTemplateKey } = require("./reportTemplateService");
const { SECTION_SEED_HTML } = require("../constants");

const REPORT_CONFIG_KEYS = {
  logoVextrom: "report.preview.logo.vextrom",
  logoChloride: "report.preview.logo.chloride",
  logoCover: "report.preview.logo.cover",
  defaultTemplate: "report.preview.template.default",
  footerHtml: "report.preview.footer.html",
  defaultScopeHtml: "report.preview.sections.scope.default_html",
  defaultRecommendationsHtml: "report.preview.sections.recommendations.default_html"
};

const DEFAULT_FOOTER_HTML = `<div class="footer-signature">
  <style>
    .footer-signature,
    .footer-signature * {
      box-sizing: border-box;
      font-family: Arial, Helvetica, sans-serif;
    }

    .footer-signature {
      width: 100%;
      max-width: 1520px;
      max-height: 300px;
      margin: 0 auto;
      padding: 14px 36px;
      color: #6f6f6f;
      overflow: hidden;
      display: flex;
      align-items: center;
    }

    .footer-content {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 40px;
      flex-wrap: nowrap;
    }

    .footer-column {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .footer-column-right {
      max-width: 380px;
    }

    .footer-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 9.8px;
      line-height: 1.2;
      color: #6f6f6f;
    }

    .footer-text,
    .footer-links {
      display: block;
      color: #6f6f6f;
    }

    .footer-link {
      color: #6f6f6f;
      text-decoration: none;
    }

    .footer-link:hover {
      text-decoration: underline;
    }

    .icon {
      width: 13px;
      height: 13px;
      min-width: 13px;
      margin-top: 1px;
      display: block;
    }

    @media (max-width: 900px) {
      .footer-signature {
        max-height: none;
        padding: 16px 20px;
      }

      .footer-content {
        flex-direction: column;
        gap: 16px;
      }

      .footer-column-right {
        max-width: 100%;
      }
    }
  </style>

  <div class="footer-content">
    <div class="footer-column">
      <div class="footer-item">
        <img class="icon" alt="Documento" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTlhODU3IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTE0IDJINmEyIDIgMCAwIDAtMiAydjE2YTIgMiAwIDAgMCAyIDJoMTJhMiAyIDAgMCAwIDItMlY4eiIvPjxwYXRoIGQ9Ik0xNCAydjZoNiIvPjxwYXRoIGQ9Ik04IDEzaDgiLz48cGF0aCBkPSJNOCAxN2g1Ii8+PC9zdmc+" />
        <div class="footer-text">CNPJ: 20.675.540/0001-82</div>
      </div>

      <div class="footer-item">
        <img class="icon" alt="Telefone" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTlhODU3IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIyIDE2LjkydjNhMiAyIDAgMCAxLTIuMTggMiAxOS43OSAxOS43OSAwIDAgMS04LjYzLTMuMDcgMTkuNSAxOS41IDAgMCAxLTYtNkExOS43OSAxOS43OSAwIDAgMSAyLjEyIDQuMTggMiAyIDAgMCAxIDQuMTEgMmgzYTIgMiAwIDAgMSAyIDEuNzJjLjEyLjkuMzMgMS43OC42MiAyLjYyYTIgMiAwIDAgMS0uNDUgMi4xMUw4LjA5IDkuOTFhMTYgMTYgMCAwIDAgNiA2bDEuNDYtMS4xOWEyIDIgMCAwIDEgMi4xMS0uNDVjLjg0LjI5IDEuNzIuNSAyLjYyLjYyQTIgMiAwIDAgMSAyMiAxNi45MnoiLz48L3N2Zz4=" />
        <div class="footer-text">+55 (11) 3672 0506</div>
      </div>

      <div class="footer-item">
        <img class="icon" alt="Localização" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzE5YTg1NyI+PHBhdGggZD0iTTEyIDIyczgtNy4yIDgtMTNhOCA4IDAgMSAwLTE2IDBjMCA1LjggOCAxMyA4IDEzem0wLTkuNUEzLjUgMy41IDAgMSAxIDEyIDVhMy41IDMuNSAwIDAgMSAwIDcuNXoiLz48L3N2Zz4=" />
        <div class="footer-text">R. Antônio das Chagas, 1155, Chácara Santo Antônio, CEP 04714-002, São Paulo, SP</div>
      </div>

      <div class="footer-item">
        <img class="icon" alt="Website" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTlhODU3IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMiAxMmgyMCIvPjxwYXRoIGQ9Ik0xMiAyYTE1LjMgMTUuMyAwIDAgMSA0IDEwIDE1LjMgMTUuMyAwIDAgMS00IDEwIDE1LjMgMTUuMyAwIDAgMS00LTEwIDE1LjMgMTUuMyAwIDAgMSA0LTEweiIvPjwvc3ZnPg==" />
        <div class="footer-links">
          <a class="footer-link" href="https://vextrom.com.br" target="_blank">vextrom.com.br</a> |
          <a class="footer-link" href="https://loja.vextrom.com.br" target="_blank">loja.vextrom.com.br</a>
        </div>
      </div>
    </div>

    <div class="footer-column footer-column-right">
      <div class="footer-item">
        <img class="icon" alt="LinkedIn" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzE5YTg1NyI+PHBhdGggZD0iTTYuOTQgOC41SDMuNTZWMjBoMy4zOFY4LjV6TTUuMjUgM0ExLjk3IDEuOTcgMCAxIDAgNS4zIDYuOTQgMS45NyAxLjk3IDAgMCAwIDUuMjUgM3pNMjAuNDQgMTMuMDJjMC0zLjQ2LTEuODUtNS4wNy00LjMxLTUuMDctMS45OSAwLTIuODggMS4xLTMuMzggMS44N1Y4LjVIOS4zOFYyMGgzLjM3di02LjRjMC0xLjY5LjMyLTMuMzMgMi40Mi0zLjMzIDIuMDcgMCAyLjEgMS45NCAyLjEgMy40NFYyMGgzLjM3di02Ljk4eiIvPjwvc3ZnPg==" />
        <div class="footer-links">
          <a class="footer-link" href="https://www.linkedin.com/company/vextrom-industria-e-comercio" target="_blank">/company/vextrom-industria-e-comercio</a>
        </div>
      </div>

      <div class="footer-item">
        <img class="icon" alt="Instagram" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTlhODU3IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iNSIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjQiLz48Y2lyY2xlIGN4PSIxNy41IiBjeT0iNi41IiByPSIxIi8+PC9zdmc+" />
        <div class="footer-links">
          <a class="footer-link" href="https://www.instagram.com/vextrom_ecommerce" target="_blank">@vextrom_ecommerce</a>
        </div>
      </div>

      <div class="footer-item">
        <img class="icon" alt="Facebook" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzE5YTg1NyI+PHBhdGggZD0iTTEzLjUgMjJ2LThoMi43bC40LTNoLTMuMVY5LjFjMC0uOS4zLTEuNiAxLjYtMS42aDEuN1Y0LjhjLS4zIDAtMS4zLS4xLTIuNS0uMS0yLjUgMC00LjIgMS41LTQuMiA0LjRWMTFIOHYzaDIuNnY4aDIuOXoiLz48L3N2Zz4=" />
        <div class="footer-links">
          <a class="footer-link" href="https://www.facebook.com/vextrom.ecommerce" target="_blank">/vextrom.ecommerce</a>
        </div>
      </div>
    </div>
  </div>
</div>`;
const DEFAULT_SCOPE_HTML = String(SECTION_SEED_HTML.scope || "<p><br></p>");
const DEFAULT_RECOMMENDATIONS_HTML = String(SECTION_SEED_HTML.recommendations || "<p><br></p>");

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
  const logoCover = String(
    settings[REPORT_CONFIG_KEYS.logoCover]
    || env.serviceReport?.logoCover
    || process.env.SERVICE_REPORT_LOGO_COVER
    || logoVextrom
  ).trim();
  const templateKey = normalizeReportTemplateKey(settings[REPORT_CONFIG_KEYS.defaultTemplate]);
  const footerHtml = settings[REPORT_CONFIG_KEYS.footerHtml] !== undefined
    ? String(settings[REPORT_CONFIG_KEYS.footerHtml])
    : DEFAULT_FOOTER_HTML;
  const defaultScopeHtml = settings[REPORT_CONFIG_KEYS.defaultScopeHtml] !== undefined
    ? String(settings[REPORT_CONFIG_KEYS.defaultScopeHtml])
    : DEFAULT_SCOPE_HTML;
  const defaultRecommendationsHtml = settings[REPORT_CONFIG_KEYS.defaultRecommendationsHtml] !== undefined
    ? String(settings[REPORT_CONFIG_KEYS.defaultRecommendationsHtml])
    : DEFAULT_RECOMMENDATIONS_HTML;

  return {
    logoVextrom,
    logoChloride,
    logoCover,
    templateKey,
    footerHtml,
    defaultScopeHtml,
    defaultRecommendationsHtml,
    defaultFooterHtml: DEFAULT_FOOTER_HTML,
    defaultSystemScopeHtml: DEFAULT_SCOPE_HTML,
    defaultSystemRecommendationsHtml: DEFAULT_RECOMMENDATIONS_HTML,
    templateOptions: getReportTemplateOptions()
  };
}

async function saveReportConfigSettings(payload = {}) {
  const logoVextrom = String(payload.logoVextrom || "").trim();
  const logoChloride = String(payload.logoChloride || "").trim();
  const logoCover = String(payload.logoCover || "").trim();
  const templateKey = normalizeReportTemplateKey(payload.templateKey);
  const footerHtml = payload.footerHtml !== undefined ? String(payload.footerHtml) : DEFAULT_FOOTER_HTML;
  const defaultScopeHtml = payload.defaultScopeHtml !== undefined
    ? String(payload.defaultScopeHtml)
    : DEFAULT_SCOPE_HTML;
  const defaultRecommendationsHtml = payload.defaultRecommendationsHtml !== undefined
    ? String(payload.defaultRecommendationsHtml)
    : DEFAULT_RECOMMENDATIONS_HTML;

  await Promise.all([
    upsertSetting(REPORT_CONFIG_KEYS.logoVextrom, logoVextrom),
    upsertSetting(REPORT_CONFIG_KEYS.logoChloride, logoChloride),
    upsertSetting(REPORT_CONFIG_KEYS.logoCover, logoCover),
    upsertSetting(REPORT_CONFIG_KEYS.defaultTemplate, templateKey),
    upsertSetting(REPORT_CONFIG_KEYS.footerHtml, footerHtml),
    upsertSetting(REPORT_CONFIG_KEYS.defaultScopeHtml, defaultScopeHtml),
    upsertSetting(REPORT_CONFIG_KEYS.defaultRecommendationsHtml, defaultRecommendationsHtml)
  ]);

  return {
    logoVextrom,
    logoChloride,
    logoCover,
    templateKey,
    footerHtml,
    defaultScopeHtml,
    defaultRecommendationsHtml
  };
}

module.exports = {
  getReportConfigSettings,
  saveReportConfigSettings
};
