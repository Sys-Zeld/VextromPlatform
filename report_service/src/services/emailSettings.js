const crypto = require("crypto");

const db = require("../../db");
const env = require("../../../specflow/config/env");

const EMAIL_SETTING_KEYS = {
  smtpHost: "report.email.smtp.host",
  smtpPort: "report.email.smtp.port",
  smtpSecure: "report.email.smtp.secure",
  smtpUser: "report.email.smtp.user",
  smtpPass: "report.email.smtp.pass",
  smtpFrom: "report.email.smtp.from",
  defaultRecipients: "report.email.default.recipients",
  htmlTemplates: "report.email.html.templates",
  htmlDefaultTemplateId: "report.email.html.default_template_id"
};

function parseBooleanSetting(value, fallback = false) {
  if (value === null || value === undefined) return Boolean(fallback);
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parsePortSetting(value, fallback = 587) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return Number(fallback) || 587;
  return parsed;
}

const VALID_PURPOSES = ["general", "nova_os", "relatorio_assinado", "envio_assinatura"];

function normalizeTemplateRecord(input, index = 0) {
  const source = input && typeof input === "object" ? input : {};
  const id = String(source.id || "").trim() || `tpl_${index + 1}`;
  const name = String(source.name || "").trim() || `Modelo ${index + 1}`;
  const subject = String(source.subject || "").trim() || "Service Report";
  const html = String(source.html || "");
  const purpose = VALID_PURPOSES.includes(source.purpose) ? source.purpose : "general";
  const createdAt = String(source.createdAt || source.created_at || "");
  const updatedAt = String(source.updatedAt || source.updated_at || "");
  return {
    id,
    name,
    subject,
    html,
    purpose,
    createdAt,
    updatedAt
  };
}

function getTemplateByPurpose(templates, defaultTemplateId, purpose) {
  const list = Array.isArray(templates) ? templates : [];
  const byPurpose = list.find((t) => t.purpose === purpose);
  if (byPurpose) return byPurpose;
  const byDefault = list.find((t) => t.id === defaultTemplateId);
  if (byDefault) return byDefault;
  return list[0] || null;
}

function parseEmailTemplates(raw) {
  const source = String(raw || "").trim();
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, index) => normalizeTemplateRecord(item, index))
      .filter((template) => template.id && template.name && template.subject && template.html);
  } catch (_err) {
    return [];
  }
}

function serializeEmailTemplates(templates) {
  const list = Array.isArray(templates) ? templates : [];
  return JSON.stringify(list, null, 2);
}

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
    [key, String(value ?? "")]
  );
}

function resolveEmailTemplateSelection(templates, requestedDefaultTemplateId) {
  const normalizedTemplates = Array.isArray(templates) ? templates : [];
  if (!normalizedTemplates.length) {
    return {
      defaultTemplateId: "",
      defaultTemplate: null
    };
  }
  const requestedId = String(requestedDefaultTemplateId || "").trim();
  const validRequested = requestedId && normalizedTemplates.some((template) => template.id === requestedId);
  const defaultTemplateId = validRequested ? requestedId : normalizedTemplates[0].id;
  const defaultTemplate = normalizedTemplates.find((template) => template.id === defaultTemplateId) || normalizedTemplates[0];
  return {
    defaultTemplateId,
    defaultTemplate
  };
}

async function getReportServiceEmailSettings() {
  const keys = Object.values(EMAIL_SETTING_KEYS);
  const settings = await getSettingsMap(keys);

  const smtp = {
    host: settings[EMAIL_SETTING_KEYS.smtpHost] || env.smtp.host || "",
    port: parsePortSetting(settings[EMAIL_SETTING_KEYS.smtpPort], env.smtp.port || 587),
    secure: parseBooleanSetting(settings[EMAIL_SETTING_KEYS.smtpSecure], env.smtp.secure),
    user: settings[EMAIL_SETTING_KEYS.smtpUser] || env.smtp.user || "",
    pass: settings[EMAIL_SETTING_KEYS.smtpPass] !== undefined ? settings[EMAIL_SETTING_KEYS.smtpPass] : (env.smtp.pass || ""),
    from: settings[EMAIL_SETTING_KEYS.smtpFrom] || env.smtp.from || "no-reply@example.com"
  };

  const defaultRecipientsRaw = String(settings[EMAIL_SETTING_KEYS.defaultRecipients] || "");
  const defaultRecipients = defaultRecipientsRaw
    .split(/[;,\r\n]+/)
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const emailTemplates = parseEmailTemplates(settings[EMAIL_SETTING_KEYS.htmlTemplates]);
  const { defaultTemplateId, defaultTemplate } = resolveEmailTemplateSelection(
    emailTemplates,
    settings[EMAIL_SETTING_KEYS.htmlDefaultTemplateId]
  );

  return {
    smtp,
    defaultRecipientsRaw,
    defaultRecipients,
    emailTemplates,
    defaultTemplateId,
    defaultTemplate,
    hasStoredSmtpPass: Boolean((settings[EMAIL_SETTING_KEYS.smtpPass] || "").trim()),
    hasEffectiveSmtpPass: Boolean(String(smtp.pass || "").trim())
  };
}

async function saveReportServiceEmailDefaultRecipients(defaultRecipientsRaw) {
  await upsertSetting(EMAIL_SETTING_KEYS.defaultRecipients, defaultRecipientsRaw || "");
}

async function saveReportServiceSmtpSettings({
  host,
  port,
  secure,
  user,
  from,
  pass,
  passwordProvided = false,
  clearPassword = false
}) {
  await Promise.all([
    upsertSetting(EMAIL_SETTING_KEYS.smtpHost, host || ""),
    upsertSetting(EMAIL_SETTING_KEYS.smtpPort, String(parsePortSetting(port, 587))),
    upsertSetting(EMAIL_SETTING_KEYS.smtpSecure, secure ? "true" : "false"),
    upsertSetting(EMAIL_SETTING_KEYS.smtpUser, user || ""),
    upsertSetting(EMAIL_SETTING_KEYS.smtpFrom, from || "")
  ]);

  if (clearPassword) {
    await upsertSetting(EMAIL_SETTING_KEYS.smtpPass, "");
  } else if (passwordProvided) {
    await upsertSetting(EMAIL_SETTING_KEYS.smtpPass, pass || "");
  }
}

async function saveReportServiceEmailHtmlTemplate({ templateId = "", name, subject, html, purpose = "general", setAsDefault = false }) {
  const keys = [EMAIL_SETTING_KEYS.htmlTemplates, EMAIL_SETTING_KEYS.htmlDefaultTemplateId];
  const settings = await getSettingsMap(keys);
  const templates = parseEmailTemplates(settings[EMAIL_SETTING_KEYS.htmlTemplates]);
  const nowIso = new Date().toISOString();
  const normalizedId = String(templateId || "").trim();
  const cleanName = String(name || "").trim();
  const cleanSubject = String(subject || "").trim();
  const cleanHtml = String(html || "");

  if (!cleanName) {
    const err = new Error("Informe um nome para o modelo.");
    err.statusCode = 422;
    throw err;
  }
  if (!cleanSubject) {
    const err = new Error("Informe um assunto para o modelo.");
    err.statusCode = 422;
    throw err;
  }
  if (!cleanHtml.trim()) {
    const err = new Error("Informe o HTML do modelo.");
    err.statusCode = 422;
    throw err;
  }

  let savedTemplate = null;
  const existingIndex = normalizedId ? templates.findIndex((item) => item.id === normalizedId) : -1;
  if (existingIndex >= 0) {
    const current = templates[existingIndex];
    const cleanPurpose = VALID_PURPOSES.includes(purpose) ? purpose : "general";
    savedTemplate = {
      ...current,
      id: current.id,
      name: cleanName,
      subject: cleanSubject,
      html: cleanHtml,
      purpose: cleanPurpose,
      updatedAt: nowIso
    };
    templates[existingIndex] = savedTemplate;
  } else {
    const cleanPurpose = VALID_PURPOSES.includes(purpose) ? purpose : "general";
    savedTemplate = {
      id: crypto.randomUUID(),
      name: cleanName,
      subject: cleanSubject,
      html: cleanHtml,
      purpose: cleanPurpose,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    templates.push(savedTemplate);
  }

  const currentDefaultTemplateId = String(settings[EMAIL_SETTING_KEYS.htmlDefaultTemplateId] || "");
  const shouldSetDefault = setAsDefault || !currentDefaultTemplateId;
  const defaultTemplateId = shouldSetDefault ? savedTemplate.id : currentDefaultTemplateId;

  await Promise.all([
    upsertSetting(EMAIL_SETTING_KEYS.htmlTemplates, serializeEmailTemplates(templates)),
    upsertSetting(EMAIL_SETTING_KEYS.htmlDefaultTemplateId, defaultTemplateId)
  ]);

  return savedTemplate;
}

async function setDefaultReportServiceEmailHtmlTemplate(templateId) {
  const normalizedId = String(templateId || "").trim();
  if (!normalizedId) {
    const err = new Error("Modelo de e-mail invalido.");
    err.statusCode = 422;
    throw err;
  }
  const settings = await getSettingsMap([EMAIL_SETTING_KEYS.htmlTemplates]);
  const templates = parseEmailTemplates(settings[EMAIL_SETTING_KEYS.htmlTemplates]);
  const exists = templates.some((item) => item.id === normalizedId);
  if (!exists) {
    const err = new Error("Modelo de e-mail nao encontrado.");
    err.statusCode = 404;
    throw err;
  }
  await upsertSetting(EMAIL_SETTING_KEYS.htmlDefaultTemplateId, normalizedId);
}

async function deleteReportServiceEmailHtmlTemplate(templateId) {
  const normalizedId = String(templateId || "").trim();
  if (!normalizedId) {
    const err = new Error("Modelo de e-mail invalido.");
    err.statusCode = 422;
    throw err;
  }

  const keys = [EMAIL_SETTING_KEYS.htmlTemplates, EMAIL_SETTING_KEYS.htmlDefaultTemplateId];
  const settings = await getSettingsMap(keys);
  const templates = parseEmailTemplates(settings[EMAIL_SETTING_KEYS.htmlTemplates]);
  const existing = templates.find((item) => item.id === normalizedId);
  if (!existing) {
    const err = new Error("Modelo de e-mail nao encontrado.");
    err.statusCode = 404;
    throw err;
  }

  const updatedTemplates = templates.filter((item) => item.id !== normalizedId);
  const currentDefaultTemplateId = String(settings[EMAIL_SETTING_KEYS.htmlDefaultTemplateId] || "");
  const nextDefaultTemplateId = currentDefaultTemplateId === normalizedId
    ? (updatedTemplates[0] ? updatedTemplates[0].id : "")
    : currentDefaultTemplateId;

  await Promise.all([
    upsertSetting(EMAIL_SETTING_KEYS.htmlTemplates, serializeEmailTemplates(updatedTemplates)),
    upsertSetting(EMAIL_SETTING_KEYS.htmlDefaultTemplateId, nextDefaultTemplateId)
  ]);
}

module.exports = {
  getReportServiceEmailSettings,
  getTemplateByPurpose,
  saveReportServiceEmailDefaultRecipients,
  saveReportServiceSmtpSettings,
  saveReportServiceEmailHtmlTemplate,
  setDefaultReportServiceEmailHtmlTemplate,
  deleteReportServiceEmailHtmlTemplate
};
