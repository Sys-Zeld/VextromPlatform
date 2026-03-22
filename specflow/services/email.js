const nodemailer = require("nodemailer");
const env = require("../config/env");
const { createTranslator } = require("../i18n");
const { getEmailSettings } = require("./emailSettings");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTemplateVariables(submission = {}) {
  const cleanBaseUrl = String(env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  const token = String(submission.token || "");
  const tokenReviewLink = token ? `${cleanBaseUrl}/form/${token}/review` : cleanBaseUrl;
  const tokenSpecificationLink = token ? `${cleanBaseUrl}/form/${token}/specification` : cleanBaseUrl;

  const variables = {
    token,
    purchaser: submission.purchaser || "",
    purchaser_contact: submission.purchaserContact || "",
    project_name: submission.projectName || "",
    site_name: submission.siteName || "",
    address: submission.address || "",
    project: submission.projectName || "",
    site: submission.siteName || "",
    profile_name: submission.profileName || "",
    token_link: tokenReviewLink,
    review_link: tokenReviewLink,
    specification_link: tokenSpecificationLink,
    cliente: submission.purchaser || "",
    contato: submission.purchaserContact || "",
    nome_perfil_formulario: submission.profileName || "",
    "perfil-formulario": submission.profileName || ""
  };

  return Object.keys(variables).reduce((acc, key) => {
    acc[String(key || "").toLowerCase()] = variables[key];
    return acc;
  }, {});
}

function renderPlaceholderString(template, variables, options = {}) {
  const source = String(template || "");
  if (!source.trim()) return "";

  const escapeValues = options.escapeValues !== false;
  return source.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => {
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(variables, normalizedKey)) {
      return match;
    }
    const value = String(variables[normalizedKey] || "");
    return escapeValues ? escapeHtml(value) : value;
  });
}

function buildSummaryHtml(sections, answersMap, lang) {
  const t = createTranslator(lang);
  const blocks = sections
    .map((section) => {
      const rows = (section.fields || [])
        .map((field) => {
          const value = answersMap[field.id] || "-";
          const unit = field.unit || "-";
          return `<tr><td style="padding:6px;border:1px solid #ddd;">${field.label}</td><td style="padding:6px;border:1px solid #ddd;">${value}</td><td style="padding:6px;border:1px solid #ddd;">${unit}</td></tr>`;
        })
        .join("");
      return `<h3>${section.title}</h3><table style="width:100%;border-collapse:collapse;margin-bottom:18px;"><thead><tr><th style="text-align:left;padding:6px;border:1px solid #ddd;">${t("email.tableField")}</th><th style="text-align:left;padding:6px;border:1px solid #ddd;">${t("email.tableValue")}</th><th style="text-align:left;padding:6px;border:1px solid #ddd;">${t("email.tableUnit")}</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join("");
  return `<!doctype html><html><body><h2>${t("email.summaryTitle")}</h2>${blocks}</body></html>`;
}

function buildSummaryHtmlFromSections(sections, lang) {
  const t = createTranslator(lang);
  const blocks = sections
    .map((section) => {
      const rows = (section.fields || [])
        .map((field) => {
          const value =
            field.displayValue !== undefined && field.displayValue !== null && field.displayValue !== ""
              ? field.displayValue
              : field.effectiveValue !== undefined && field.effectiveValue !== null && field.effectiveValue !== ""
                ? field.effectiveValue
                : "-";
          const unit = field.unit || "-";
          return `<tr><td style="padding:6px;border:1px solid #ddd;">${field.label}</td><td style="padding:6px;border:1px solid #ddd;">${value}</td><td style="padding:6px;border:1px solid #ddd;">${unit}</td></tr>`;
        })
        .join("");
      const sectionTitle = section.section || section.title || "-";
      return `<h3>${sectionTitle}</h3><table style="width:100%;border-collapse:collapse;margin-bottom:18px;"><thead><tr><th style="text-align:left;padding:6px;border:1px solid #ddd;">${t("email.tableField")}</th><th style="text-align:left;padding:6px;border:1px solid #ddd;">${t("email.tableValue")}</th><th style="text-align:left;padding:6px;border:1px solid #ddd;">${t("email.tableUnit")}</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join("");
  return `<!doctype html><html><body><h2>${t("email.summaryTitle")}</h2>${blocks}</body></html>`;
}

function sanitizeSubjectHeaderValue(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

async function sendSubmissionEmail({ to, cc, submission, sections, pdfBuffer, lang }) {
  const t = createTranslator(lang);
  const settings = await getEmailSettings();
  const transporter = nodemailer.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth: settings.smtp.user
      ? {
          user: settings.smtp.user,
          pass: settings.smtp.pass
        }
      : undefined
  });

  const variables = buildTemplateVariables(submission);
  let subject = t("email.subject", { token: submission.token });
  let html = buildSummaryHtmlFromSections(sections, lang);

  if (settings.defaultTemplate && settings.defaultTemplate.html) {
    subject = settings.defaultTemplate.subject
      ? renderPlaceholderString(settings.defaultTemplate.subject, variables, { escapeValues: false })
      : subject;
    html = renderPlaceholderString(settings.defaultTemplate.html, variables, { escapeValues: true });
  }

  return transporter.sendMail({
    from: settings.smtp.from,
    to,
    cc: cc && cc.length ? cc : undefined,
    subject: sanitizeSubjectHeaderValue(subject),
    html,
    attachments: [
      {
        filename: `annexD-${submission.token}.pdf`,
        content: pdfBuffer
      }
    ]
  });
}

async function sendSmtpTestEmail({ to }) {
  const settings = await getEmailSettings();
  const transporter = nodemailer.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth: settings.smtp.user
      ? {
          user: settings.smtp.user,
          pass: settings.smtp.pass
        }
      : undefined
  });

  const testSubmission = {
    token: "TEST-SMTP",
    purchaser: "Cliente Teste",
    purchaserContact: "Contato Teste",
    projectName: "Projeto Teste",
    siteName: "Site Teste",
    address: "Endereco Teste",
    profileName: "Perfil Teste"
  };
  const variables = buildTemplateVariables(testSubmission);
  const fallbackHtml = "<p style=\"margin:0 0 16px 0;line-height:1.5;\">Modelo HTML de e-mail nao configurado.</p>";
  const selectedTemplate = settings.defaultTemplate || null;
  const htmlBody = selectedTemplate && selectedTemplate.html
    ? renderPlaceholderString(selectedTemplate.html, variables, { escapeValues: true })
    : fallbackHtml;
  const subject = selectedTemplate && selectedTemplate.subject
    ? renderPlaceholderString(selectedTemplate.subject, variables, { escapeValues: false })
    : "VEXTROM - Teste SMTP";
  const timestamp = new Date().toISOString();

  return transporter.sendMail({
    from: settings.smtp.from,
    to,
    subject: sanitizeSubjectHeaderValue(subject),
    html: `<!doctype html><html><body>${htmlBody}<hr><p><strong>Tipo:</strong> Teste SMTP</p><p><strong>Data:</strong> ${timestamp}</p></body></html>`,
    text: `Teste SMTP\nModelo aplicado.\nData: ${timestamp}`
  });
}

module.exports = {
  sendSubmissionEmail,
  sendSmtpTestEmail,
  buildSummaryHtml,
  buildSummaryHtmlFromSections
};
