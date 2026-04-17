const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const repo = require("../repositories/serviceReportRepository");
const service = require("../services/serviceReportService");
const {
  buildPdfBufferFromHtml,
  buildPdfBufferFromUrl
} = require("../services/serviceReportPdfService");
const env = require("../../../specflow/config/env");
const { getReportConfigSettings, saveReportConfigSettings } = require("../services/reportConfigSettings");
const { getReportServiceEmailSettings, getTemplateByPurpose } = require("../services/emailSettings");
const { buildPreviewModel } = require("../services/reportPreviewService");
const {
  renderReportPreviewHtml,
  getReportTemplateOptions,
  normalizeReportTemplateKey
} = require("../services/reportTemplateService");
const { sanitizeReportSectionHtml } = require("../services/quillContentService");
const { withServiceOrderDisplay } = require("../utils/serviceOrderDisplay");
const {
  SECTION_DEFINITIONS,
  QUILL_SECTION_TOOLBAR,
  QUILL_SECTION_TITLE_TOOLBAR,
  QUILL_SECTION_FORMATS,
  QUILL_SECTION_TITLE_FORMATS,
  COMPONENT_CATEGORIES,
  SIGNER_TYPES
} = require("../constants");

function getSharpOrNull() {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require("sharp");
  } catch (_err) {
    return null;
  }
}

async function optimizeTagImageUploadBuffer(buffer, ext) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return buffer;
  const normalizedExt = String(ext || "").toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(normalizedExt)) return buffer;

  const sharp = getSharpOrNull();
  if (!sharp) return buffer;

  try {
    const source = sharp(buffer, { animated: false });
    const metadata = await source.metadata();
    const width = Number(metadata.width || 0);
    const transformed = width > 1600
      ? source.resize({ width: 1600, withoutEnlargement: true })
      : source;

    if (normalizedExt === ".png") {
      return transformed.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    }
    if (normalizedExt === ".webp") {
      return transformed.webp({ quality: 80 }).toBuffer();
    }
    return transformed.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  } catch (_err) {
    return buffer;
  }
}

function createReportWebController(deps) {
  const sanitizeInput = deps.sanitizeInput;
  const sanitizeRichTextInput = deps.sanitizeRichTextInput || deps.sanitizeInput;
  const reviseTextWithAi = deps.reviseTextWithAi;
  const extractSparePartsFromDocument = deps.extractSparePartsFromDocument;
  const getSparePartsDefaultPrompt = deps.getSparePartsDefaultPrompt;
  const getSparePartsJsonSchema = deps.getSparePartsJsonSchema;
  const hasValidRequiredFk = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
  const normalizeModelToken = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  const normalizePartNumberToken = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  const extractModelTokens = (value) => {
    const raw = String(value || "");
    const parts = raw
      .split(/[,;/|]+/)
      .map((item) => normalizeModelToken(item))
      .filter(Boolean);
    const full = normalizeModelToken(raw);
    if (full && !parts.includes(full)) parts.push(full);
    return parts;
  };
  const isModelMatch = (spareModel, equipmentFamily) => {
    const spareTokens = extractModelTokens(spareModel);
    const familyTokens = extractModelTokens(equipmentFamily);
    if (!spareTokens.length || !familyTokens.length) return false;
    for (const spare of spareTokens) {
      for (const family of familyTokens) {
        if (spare === family) return true;
        if (spare.length >= 3 && family.includes(spare)) return true;
        if (family.length >= 3 && spare.includes(family)) return true;
      }
    }
    return false;
  };
  const isSiteLinkedToCustomer = async (customerIdRaw, siteIdRaw) => {
    const customerId = Number(customerIdRaw);
    const siteId = Number(siteIdRaw);
    if (!Number.isInteger(customerId) || customerId <= 0) return false;
    if (!Number.isInteger(siteId) || siteId <= 0) return false;
    const site = await repo.getSiteById(siteId);
    return Boolean(site && Number(site.customer_id) === customerId);
  };
  const buildTemplatePreviewRoute = (orderId, templateKey) => `/admin/report-service/orders/${orderId}/preview-html/template/${normalizeReportTemplateKey(templateKey)}`;
  const resolveRequestBaseUrl = (req) => {
    const host = String((req.get && req.get("host")) || req.headers.host || "").trim();
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwardedProto || req.protocol || "http";
    if (host) return `${protocol}://${host}`;
    return String(env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  };
  const buildTemplatePreviewAbsoluteUrl = (req, orderId, templateKey) => `${resolveRequestBaseUrl(req)}${buildTemplatePreviewRoute(orderId, templateKey)}`;
  const buildSignedReportLink = (req, token) => `${resolveRequestBaseUrl(req)}/r/signed/${encodeURIComponent(String(token || "").trim())}`;
  const buildSignRequestLink = (req, token) => `${resolveRequestBaseUrl(req)}/r/sign/${encodeURIComponent(String(token || "").trim())}`;
  const REPORT_LANGUAGES = Object.freeze({
    pt: { key: "pt", label: "Português" },
    en: { key: "en", label: "Inglês" },
    es: { key: "es", label: "Espanhol" },
    fr: { key: "fr", label: "Francês" }
  });
  const REPORT_LANGUAGE_KEYS = Object.keys(REPORT_LANGUAGES);
  const translationJobs = new Map();

  function normalizeReportLanguage(value, fallback = "pt") {
    const normalized = String(value || "").trim().toLowerCase();
    return REPORT_LANGUAGE_KEYS.includes(normalized) ? normalized : fallback;
  }

  function stripHtmlToText(value) {
    return String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildTranslationSystemInstruction(languageKey) {
    const lang = REPORT_LANGUAGES[normalizeReportLanguage(languageKey)] || REPORT_LANGUAGES.pt;
    return `Voce e um tradutor tecnico. Traduza o texto recebido para ${lang.label}. Retorne apenas o texto traduzido, sem nenhuma explicacao, prefixo, rotulo ou comentario adicional. Preserve exatamente codigos tecnicos, placeholders como @img=ID, @equip=ID, @tblequip e URLs sem qualquer alteracao.`;
  }

  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const m = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function findTimesheetOverlap(entries, activityDate, checkIn, checkOut, excludeId) {
    const newStart = parseTimeToMinutes(checkIn);
    const newEnd = parseTimeToMinutes(checkOut);
    if (newStart === null || newEnd === null || newEnd <= newStart) return null;
    const dateStr = String(activityDate || "").slice(0, 10);
    for (const entry of entries) {
      if (excludeId !== null && Number(entry.id) === excludeId) continue;
      const entryDate = String(entry.activity_date || "").slice(0, 10);
      if (entryDate !== dateStr) continue;
      const eStart = parseTimeToMinutes(entry.check_in_client || entry.check_in_base);
      const eEnd = parseTimeToMinutes(entry.check_out_client || entry.check_out_base);
      if (eStart === null || eEnd === null) continue;
      // overlap: newStart < eEnd AND newEnd > eStart
      if (newStart < eEnd && newEnd > eStart) return entry;
    }
    return null;
  }

  function buildOrderValidationSummary(data) {
    const orderEquipments = Array.isArray(data?.orderEquipments) ? data.orderEquipments : [];
    const timesheet = Array.isArray(data?.timesheet) ? data.timesheet : [];
    const dailyLogs = Array.isArray(data?.dailyLogs) ? data.dailyLogs : [];
    const technicians = Array.isArray(data?.technicians) ? data.technicians : [];

    const hasEquipment = orderEquipments.length > 0;
    const hasTimesheet = timesheet.length > 0;
    const hasDailyDescription = dailyLogs.some((item) => String(item?.notes || "").trim().toLowerCase() !== "conclusaogeral");
    const hasConclusion = dailyLogs.some((item) => String(item?.notes || "").trim().toLowerCase() === "conclusaogeral");
    const hasTechnicalTeam = technicians.length > 0;

    const missing = [];
    if (!hasEquipment) missing.push("A OS precisa de pelo menos 1 equipamento associado.");
    if (!hasTimesheet) missing.push("A OS precisa de pelo menos 1 registro de timesheet.");
    if (!hasDailyDescription) missing.push("A OS precisa de pelo menos 1 descricao diaria.");
    if (!hasConclusion) missing.push("A OS precisa de pelo menos 1 conclusao geral.");
    if (!hasTechnicalTeam) missing.push("A OS precisa de pelo menos 1 pessoa na equipe tecnica.");

    return {
      valid: missing.length === 0,
      hasEquipment,
      hasTimesheet,
      hasDailyDescription,
      hasConclusion,
      hasTechnicalTeam,
      missing
    };
  }

  function buildElectronicSignatureLinkGuard(data) {
    const orderStatus = String(data?.order?.status || "").toLowerCase();
    const signatures = Array.isArray(data?.signatures) ? data.signatures : [];
    const hasValidOrder = orderStatus === "valid";
    const hasVextromSignature = signatures.some(
      (item) => String(item?.signer_type || "").toLowerCase() === "vextrom_technician"
    );
    const allowed = hasValidOrder && hasVextromSignature;

    const reasons = [];
    if (!hasValidOrder) reasons.push("A OS precisa estar com status valid.");
    if (!hasVextromSignature) reasons.push("E obrigatoria pelo menos 1 assinatura do tecnico Vextrom.");

    return {
      allowed,
      hasValidOrder,
      hasVextromSignature,
      reasons
    };
  }

  function parseEmailList(raw) {
    return String(raw || "")
      .split(/[;,\r\n]+/)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  function isValidEmailAddress(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
  }

  function sanitizeSubjectHeaderValue(value) {
    return String(value || "").replace(/[\r\n]+/g, " ").trim();
  }

  function incrementReportRevision(value) {
    const input = String(value || "").trim().toUpperCase();
    if (!/^[A-Z]+$/.test(input)) return "A";
    const chars = input.split("");
    let cursor = chars.length - 1;
    while (cursor >= 0) {
      if (chars[cursor] !== "Z") {
        chars[cursor] = String.fromCharCode(chars[cursor].charCodeAt(0) + 1);
        return chars.join("");
      }
      chars[cursor] = "A";
      cursor -= 1;
    }
    return `A${chars.join("")}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderEmailPlaceholder(template, variables) {
    return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => {
      const k = String(key || "").trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(variables, k)) return match;
      return escapeHtml(String(variables[k] || ""));
    });
  }

  function buildOsTemplateVariables(order, technicians) {
    const techNames = (Array.isArray(technicians) ? technicians : [])
      .map((t) => String(t.name || "").trim())
      .filter(Boolean)
      .join(", ");
    return {
      os_codigo: order.service_order_code || order.service_order_display || `OS-${order.id}`,
      os_titulo: order.title || "",
      cliente: order.customer_name || "",
      local: order.site_name || "",
      data_abertura: (() => {
        const val = order.opening_date;
        if (!val) return "";
        // node-postgres retorna colunas DATE como objetos Date (meia-noite UTC)
        // String(dateObj) produz "Sat Apr 11 2026..." que quebra o regex ISO
        const iso = val instanceof Date
          ? `${val.getUTCFullYear()}-${String(val.getUTCMonth() + 1).padStart(2, "0")}-${String(val.getUTCDate()).padStart(2, "0")}`
          : String(val).slice(0, 10);
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
      })(),
      status: order.status || "",
      tecnicos: techNames
    };
  }

  function buildSignedReportTemplateVariables(order, report, signedLink, extra = {}) {
    return {
      os_codigo: order.service_order_code || order.service_order_display || `OS-${order.id}`,
      relatorio_numero: String(report.report_number || ""),
      cliente: order.customer_name || "",
      local: order.site_name || "",
      link_relatorio: signedLink || "",
      signatario: String(extra.signatario || "")
    };
  }

  function hasSignedApproval(signRequests, signatures) {
    const requests = Array.isArray(signRequests) ? signRequests : [];
    const sigs = Array.isArray(signatures) ? signatures : [];
    const hasSignedRequest = requests.some((item) => String(item.status || "").toLowerCase() === "signed");
    const hasCustomerSignature = sigs.some((item) => String(item.signer_type || "").toLowerCase() === "customer_responsible");
    return hasSignedRequest || hasCustomerSignature;
  }

  function isOrderApproved(order) {
    return String(order && order.status ? order.status : "").toLowerCase() === "approved";
  }

  function buildOrderEditorRedirect(req, orderId) {
    const returnTo = String((req.body && req.body.return_to) || (req.query && req.query.return_to) || "").trim().toLowerCase();
    if (returnTo === "order-editor") {
      return `/admin/report-service/orders/${orderId}`;
    }
    if (returnTo === "report-editor") {
      return `/admin/report-service/orders/${orderId}/report-editor`;
    }
    const referer = String(req.headers.referer || "");
    if (referer.includes(`/admin/report-service/orders/${orderId}/report-editor`)) {
      return `/admin/report-service/orders/${orderId}/report-editor`;
    }
    if (referer.includes(`/admin/report-service/orders/${orderId}`)) {
      return `/admin/report-service/orders/${orderId}`;
    }
    // Default to report-editor to keep post-actions in the editor flow.
    return `/admin/report-service/orders/${orderId}/report-editor`;
  }

  function isSystemAdminUser(res) {
    return String(res.locals.adminRole || "").toLowerCase() === "admin";
  }

  async function ensureOrderEditable(req, res, orderId, options = {}) {
    const order = await repo.getOrderById(orderId);
    if (!order) {
      if (options.json) {
        res.status(404).json({ ok: false, error: "OS nao encontrada." });
      } else {
        res.status(404).send("OS nao encontrada.");
      }
      return null;
    }

    if (isOrderApproved(order)) {
      const message = "OS aprovada. Edicao bloqueada. Use Revalidar OS para liberar.";
      if (options.json) {
        res.status(423).json({ ok: false, error: message });
      } else {
        const redirectBase = buildOrderEditorRedirect(req, orderId);
        res.redirect(`${redirectBase}?edit_locked=1`);
      }
      return null;
    }

    return order;
  }

  async function loadOrderEditorData(orderId) {
    const order = await repo.getOrderById(orderId);
    if (!order) return null;
    const report = await service.ensureReportForOrder(orderId, order.title);
    const [
      customers,
      sites,
      allEquipments,
      orderEquipments,
      timesheet,
      dailyLogs,
      sections,
      components,
      signatures,
      technicians,
      instruments,
      images
    ] = await Promise.all([
      repo.listCustomers(),
      repo.listSites(order.customer_id ? { customerId: order.customer_id } : {}),
      repo.listEquipments(),
      repo.listOrderEquipments(orderId),
      repo.listTimesheetByOrder(orderId),
      repo.listDailyLogsByOrder(orderId),
      repo.listSections(report.id),
      repo.listComponents(report.id),
      repo.listSignatures(report.id),
      repo.listTechniciansByOrder(orderId),
      repo.listInstrumentsByOrder(orderId),
      repo.listImages(report.id)
    ]);
    const equipments = (allEquipments || []).filter((equipment) => {
      const sameCustomer = Number(equipment.customer_id) === Number(order.customer_id);
      if (!sameCustomer) return false;
      if (Number.isInteger(Number(order.site_id)) && Number(order.site_id) > 0) {
        return Number(equipment.site_id) === Number(order.site_id);
      }
      return true;
    });
    const orderEquipmentIds = (orderEquipments || [])
      .map((item) => Number(item.equipment_id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const linkedSpareParts = await repo.listSparePartsByEquipmentIds(orderEquipmentIds);
    const orderSparePartsByEquipment = linkedSpareParts.reduce((acc, item) => {
      const key = String(item.equipment_id || "");
      if (!key) return acc;
      if (!Array.isArray(acc[key])) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    return {
      order,
      report,
      customers,
      sites,
      equipments,
      orderEquipments,
      timesheet,
      dailyLogs,
      sections,
      components,
      signatures,
      technicians,
      instruments,
      images,
      orderSparePartsByEquipment
    };
  }

  async function resolveRenderConfig(reqTemplateKey = "", explicitConfig = null) {
    const reportConfig = explicitConfig || await getReportConfigSettings();
    const templateKey = normalizeReportTemplateKey(reqTemplateKey || reportConfig.templateKey);
    return { reportConfig, templateKey };
  }

  async function buildPdfFromPreviewRoute(req, orderId, templateKey, payload) {
    const { reportConfig } = await resolveRenderConfig(templateKey, null);
    const htmlSource = await renderReportPreviewHtml(payload, { reportConfig, templateKey });
    return buildPdfBufferFromHtml(htmlSource, payload);
  }

  function maskProtectedTokens(inputText) {
    const source = String(inputText || "");
    const matches = [];
    const masked = source.replace(/(@[a-z_]+(?:\s*=\s*\d+)?|https?:\/\/[^\s<>"']+|\/docs\/report\/img\/[^\s<>"']+)/gi, (found) => {
      const token = `[[[KEEP_TOKEN_${matches.length}]]]`;
      matches.push(found);
      return token;
    });
    return { masked, matches };
  }

  function unmaskProtectedTokens(inputText, matches = []) {
    let output = String(inputText || "");
    matches.forEach((value, index) => {
      const token = `[[[KEEP_TOKEN_${index}]]]`;
      output = output.split(token).join(String(value || ""));
    });
    return output;
  }

  async function translateTextUsingAi(sourceText, targetLanguage, cache = null) {
    const text = String(sourceText || "");
    if (!text.trim()) return text;
    const cacheKey = `${normalizeReportLanguage(targetLanguage, "pt")}::${text}`;
    if (cache && cache.has(cacheKey)) return cache.get(cacheKey);
    if (typeof reviseTextWithAi !== "function") {
      const err = new Error("Servico de IA indisponivel.");
      err.statusCode = 500;
      throw err;
    }
    const { masked, matches } = maskProtectedTokens(text);
    const result = await reviseTextWithAi({
      text: masked,
      systemInstruction: buildTranslationSystemInstruction(targetLanguage),
      preserveFormatting: false
    });
    const translatedRaw = String(result && result.revisedText ? result.revisedText : "");
    const translated = unmaskProtectedTokens(translatedRaw, matches);
    if (cache) cache.set(cacheKey, translated);
    return translated;
  }

  async function translateTextKeepingSpacing(sourceText, targetLanguage, cache = null) {
    const text = String(sourceText || "");
    if (!text.trim()) return text;
    const leading = (text.match(/^\s+/) || [""])[0];
    const trailing = (text.match(/\s+$/) || [""])[0];
    const middle = text.slice(leading.length, text.length - trailing.length);
    const translatedMiddle = await translateTextUsingAi(middle, targetLanguage, cache);
    return `${leading}${String(translatedMiddle || "").trim()}${trailing}`;
  }

  function normalizeDelta(rawDelta, fallbackText = "") {
    if (rawDelta && typeof rawDelta === "object" && Array.isArray(rawDelta.ops)) {
      return rawDelta;
    }
    if (typeof rawDelta === "string" && rawDelta.trim()) {
      try {
        const parsed = JSON.parse(rawDelta);
        if (parsed && Array.isArray(parsed.ops)) return parsed;
      } catch (_err) {
        // ignore parse errors and fallback
      }
    }
    return {
      ops: [{ insert: `${String(fallbackText || "")}\n` }]
    };
  }

  function extractTextFromDelta(delta) {
    if (!delta || !Array.isArray(delta.ops)) return "";
    return delta.ops
      .map((op) => (op && typeof op.insert === "string" ? op.insert : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function translateDeltaUsingAi(sourceDelta, targetLanguage, fallbackText = "", cache = null) {
    const delta = normalizeDelta(sourceDelta, fallbackText);
    const translatedOps = [];
    for (const op of delta.ops) {
      if (typeof op?.insert === "string") {
        // eslint-disable-next-line no-await-in-loop
        const translatedInsert = await translateTextKeepingSpacing(op.insert, targetLanguage, cache);
        translatedOps.push({
          ...op,
          insert: translatedInsert
        });
      } else {
        translatedOps.push(op);
      }
    }
    return { ops: translatedOps };
  }

  async function translateHtmlPreservingStructure(sourceHtml, targetLanguage, cache = null) {
    const html = String(sourceHtml || "").trim();
    if (!html) return "";
    const tokens = html.split(/(<[^>]+>)/g);
    const output = [];
    for (const token of tokens) {
      if (!token) continue;
      if (token.startsWith("<")) {
        output.push(token);
      } else {
        // eslint-disable-next-line no-await-in-loop
        const translatedToken = await translateTextKeepingSpacing(token, targetLanguage, cache);
        output.push(translatedToken);
      }
    }
    return sanitizeReportSectionHtml(output.join(""));
  }

  async function translatePersistedReportContent(orderId, targetLanguage, options = {}) {
    const normalizedTarget = normalizeReportLanguage(targetLanguage, "pt");
    const translationCache = new Map();
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const data = await loadOrderEditorData(orderId);
    if (!data || !data.report) {
      const err = new Error("OS nao encontrada.");
      err.statusCode = 404;
      throw err;
    }
    const currentLanguage = normalizeReportLanguage(data.report.document_language, "pt");
    if (currentLanguage === normalizedTarget) {
      if (onProgress) {
        onProgress({
          progress: 100,
          message: `Relatorio ja esta em ${REPORT_LANGUAGES[normalizedTarget].label}.`,
          current: 0,
          total: 0
        });
      }
      return { changed: false, targetLanguage: normalizedTarget };
    }

    const sections = Array.isArray(data.sections) ? data.sections : [];
    const dailyLogs = Array.isArray(data.dailyLogs) ? data.dailyLogs : [];
    const components = Array.isArray(data.components) ? data.components : [];
    const images = Array.isArray(data.images) ? data.images : [];
    const totalSteps = 1 + sections.length + dailyLogs.length + components.length + images.length;
    let doneSteps = 0;
    const emitProgress = (message) => {
      doneSteps += 1;
      if (!onProgress) return;
      onProgress({
        progress: Math.max(1, Math.min(99, Math.round((doneSteps / totalSteps) * 100))),
        message,
        current: doneSteps,
        total: totalSteps
      });
    };

    const translatedReportTitle = await translateTextUsingAi(data.report.title || "", normalizedTarget, translationCache);
    await service.updateReport(data.report.id, {
      revision: data.report.revision,
      title: translatedReportTitle || data.report.title,
      status: data.report.status,
      issueDate: data.report.issue_date,
      documentLanguage: normalizedTarget,
      preparedBy: data.report.prepared_by || "",
      reviewedBy: data.report.reviewed_by || "",
      approvedBy: data.report.approved_by || "",
      pdfPath: data.report.pdf_path || ""
    });
    emitProgress("Traduzindo dados principais do relatorio...");

    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      const sectionTitleSource = String(section.section_title_text || section.section_title || "");
      const sectionContentSource = String(section.content_text || stripHtmlToText(section.content_html || ""));
      // eslint-disable-next-line no-await-in-loop
      const translatedTitleDelta = await translateDeltaUsingAi(
        section.section_title_delta_json,
        normalizedTarget,
        sectionTitleSource,
        translationCache
      );
      // eslint-disable-next-line no-await-in-loop
      const translatedContentDelta = await translateDeltaUsingAi(
        section.content_delta_json,
        normalizedTarget,
        sectionContentSource,
        translationCache
      );
      let translatedTitleHtml = String(section.section_title_html || "");
      let translatedContentHtml = String(section.content_html || "");
      if (translatedTitleHtml.trim()) {
        // eslint-disable-next-line no-await-in-loop
        translatedTitleHtml = await translateHtmlPreservingStructure(translatedTitleHtml, normalizedTarget, translationCache);
      }
      if (translatedContentHtml.trim()) {
        // eslint-disable-next-line no-await-in-loop
        translatedContentHtml = await translateHtmlPreservingStructure(translatedContentHtml, normalizedTarget, translationCache);
      }
      const translatedTitleText = extractTextFromDelta(translatedTitleDelta) || sectionTitleSource;
      const translatedContentText = extractTextFromDelta(translatedContentDelta) || sectionContentSource;

      // eslint-disable-next-line no-await-in-loop
      await service.upsertReportSection(data.report.id, section.section_key, {
        sectionTitle: translatedTitleText || section.section_title || "",
        sectionTitleText: translatedTitleText || section.section_title_text || "",
        sectionTitleHtml: translatedTitleHtml || section.section_title_html || "",
        sectionTitleDeltaJson: translatedTitleDelta,
        contentText: translatedContentText || section.content_text || "",
        contentHtml: translatedContentHtml || section.content_html || "",
        contentDeltaJson: translatedContentDelta,
        imageLeftPath: section.image_left_path || "",
        imageRightPath: section.image_right_path || "",
        sortOrder: section.sort_order,
        isVisible: section.is_visible !== false
      });
      emitProgress(`Traduzindo capitulo ${i + 1}/${sections.length}...`);
    }

    for (let i = 0; i < dailyLogs.length; i += 1) {
      const log = dailyLogs[i];
      const sourceTitle = String(log.title || "").trim();
      const sourceContent = String(log.content || "").trim();
      // eslint-disable-next-line no-await-in-loop
      const translatedTitle = sourceTitle ? await translateTextUsingAi(sourceTitle, normalizedTarget, translationCache) : "";
      // eslint-disable-next-line no-await-in-loop
      const translatedContent = sourceContent ? await translateTextUsingAi(sourceContent, normalizedTarget, translationCache) : "";
      // eslint-disable-next-line no-await-in-loop
      await repo.updateDailyLogByOrderAndId(orderId, Number(log.id), {
        activityDate: log.activity_date,
        title: translatedTitle || sourceTitle,
        content: translatedContent || sourceContent,
        notes: log.notes || "",
        sortOrder: Number(log.sort_order || 0)
      });
      emitProgress(`Traduzindo descricoes diarias ${i + 1}/${dailyLogs.length}...`);
    }

    for (let i = 0; i < components.length; i += 1) {
      const component = components[i];
      const sourceDescription = String(component.description || "").trim();
      const sourceNotes = String(component.notes || "").trim();
      // eslint-disable-next-line no-await-in-loop
      const translatedDescription = sourceDescription ? await translateTextUsingAi(sourceDescription, normalizedTarget, translationCache) : "";
      // eslint-disable-next-line no-await-in-loop
      const translatedNotes = sourceNotes ? await translateTextUsingAi(sourceNotes, normalizedTarget, translationCache) : "";
      // eslint-disable-next-line no-await-in-loop
      await repo.updateComponent(Number(component.id), {
        category: component.category,
        equipmentId: component.equipment_id ? Number(component.equipment_id) : null,
        quantity: Number(component.quantity || 1),
        description: translatedDescription || sourceDescription,
        partNumber: component.part_number || "",
        notes: translatedNotes || sourceNotes,
        sortOrder: Number(component.sort_order || 0)
      });
      emitProgress(`Traduzindo componentes ${i + 1}/${components.length}...`);
    }

    for (let i = 0; i < images.length; i += 1) {
      const image = images[i];
      const sourceCaption = String(image.caption || "").trim();
      // eslint-disable-next-line no-await-in-loop
      const translatedCaption = sourceCaption ? await translateTextUsingAi(sourceCaption, normalizedTarget, translationCache) : "";
      // eslint-disable-next-line no-await-in-loop
      await repo.updateImageCaption(Number(image.id), translatedCaption || sourceCaption);
      emitProgress(`Traduzindo legendas de imagens ${i + 1}/${images.length}...`);
    }

    if (onProgress) {
      onProgress({
        progress: 100,
        message: `Traducao concluida para ${REPORT_LANGUAGES[normalizedTarget].label}.`,
        current: totalSteps,
        total: totalSteps
      });
    }

    return { changed: true, targetLanguage: normalizedTarget };
  }

  function createTranslationJob({ orderId, targetLanguage }) {
    const jobId = uuidv4();
    const nowIso = new Date().toISOString();
    const job = {
      id: jobId,
      orderId,
      targetLanguage,
      status: "queued",
      progress: 0,
      message: "Tradução na fila...",
      error: "",
      createdAt: nowIso,
      updatedAt: nowIso,
      finishedAt: ""
    };
    translationJobs.set(jobId, job);

    (async () => {
      try {
        job.status = "running";
        job.message = "Iniciando tradução com IA...";
        job.updatedAt = new Date().toISOString();
        const result = await translatePersistedReportContent(orderId, targetLanguage, {
          onProgress(state) {
            job.progress = Number(state && state.progress ? state.progress : job.progress);
            job.message = String(state && state.message ? state.message : job.message);
            job.updatedAt = new Date().toISOString();
          }
        });
        job.status = "completed";
        job.progress = 100;
        job.message = `Tradução concluída (${REPORT_LANGUAGES[result.targetLanguage].label}).`;
      } catch (err) {
        job.status = "failed";
        job.error = err && err.message ? err.message : "Falha ao traduzir relatório.";
        job.message = "Falha na tradução.";
      } finally {
        job.updatedAt = new Date().toISOString();
        job.finishedAt = new Date().toISOString();
        setTimeout(() => {
          translationJobs.delete(jobId);
        }, 30 * 60 * 1000);
      }
    })();

    return job;
  }

  return {
    async home(_req, res) {
      return res.redirect("/admin/report-service/orders");
    },

    async listOrders(req, res) {
      const [orders, customers, allGlobalTechnicians, sites] = await Promise.all([
        repo.listOrders(),
        repo.listCustomers(),
        repo.listGlobalTechnicians(),
        repo.listSites()
      ]);
      const ordersView = orders.map((order) => withServiceOrderDisplay(order));
      const orderIds = ordersView
        .map((order) => Number(order.id))
        .filter((id) => Number.isInteger(id) && id > 0);
      const technicianLinks = await repo.listOrderTechnicianLinks(orderIds);
      const orderTechnicianIdsByOrder = technicianLinks.reduce((acc, row) => {
        const orderId = Number(row.order_id);
        const techId = Number(row.technician_id);
        if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(techId) || techId <= 0) {
          return acc;
        }
        if (!Array.isArray(acc[orderId])) {
          acc[orderId] = [];
        }
        acc[orderId].push(techId);
        return acc;
      }, {});
      return res.render("report-service/orders", {
        pageTitle: "Service Report - Ordens de Servico",
        orders: ordersView,
        customers,
        sites,
        allGlobalTechnicians,
        created: req.query.created === "1",
        createError: sanitizeInput(req.query.create_error).toLowerCase(),
        updated: req.query.updated === "1",
        editLocked: req.query.edit_locked === "1",
        updateError: req.query.update_error === "1",
        deleted: req.query.deleted === "1",
        orderTechnicianIdsByOrder,
        csrfToken: req.csrfToken()
      });
    },

    async createOrder(req, res) {
      if (!isSystemAdminUser(res)) {
        return res.redirect("/admin/report-service/orders?create_error=forbidden_admin");
      }
      const created = await service.createOrder({
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        title: req.body.title,
        description: req.body.description,
        status: req.body.status,
        openingDate: req.body.opening_date,
        createdBy: res.locals.adminUsername || ""
      });
      const techIds = [].concat(req.body["technician_ids[]"] || req.body.technician_ids || [])
        .map(Number).filter((id) => id > 0);
      for (const techId of techIds) {
        await repo.linkTechnicianToOrder(created.id, techId);
      }
      return res.redirect("/admin/report-service/orders?created=1");
    },

    async updateOrderRegistration(req, res) {
      const orderId = Number(req.params.id);
      const order = await repo.getOrderById(orderId);
      if (!order) return res.status(404).send("OS nao encontrada.");
      if (isOrderApproved(order)) {
        return res.redirect("/admin/report-service/orders?edit_locked=1");
      }

      const techIds = [].concat(req.body["technician_ids[]"] || req.body.technician_ids || [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0);
      const uniqueTechIds = Array.from(new Set(techIds));
      if (!uniqueTechIds.length) {
        return res.redirect("/admin/report-service/orders?update_error=1");
      }

      await service.updateOrder(orderId, {
        customerId: order.customer_id,
        siteId: order.site_id,
        title: sanitizeInput(req.body.title),
        description: sanitizeInput(req.body.description),
        status: order.status,
        openingDate: sanitizeInput(req.body.opening_date) || order.opening_date || null,
        closingDate: order.closing_date,
        updatedBy: res.locals.adminUsername || ""
      });
      await repo.replaceTechniciansByOrder(orderId, uniqueTechIds);
      return res.redirect("/admin/report-service/orders?updated=1");
    },

    async deleteOrder(req, res) {
      const orderId = Number(req.params.id);
      const deleted = await repo.deleteOrder(orderId);
      if (!deleted) return res.status(404).send("OS nao encontrada.");
      return res.redirect("/admin/report-service/orders?deleted=1");
    },

    async listCustomers(req, res) {
      const [customers, sites] = await Promise.all([
        repo.listCustomers(),
        repo.listSites()
      ]);
      return res.render("report-service/customers", {
        pageTitle: "Service Report - Clientes",
        customers,
        sites,
        created: req.query.created === "1",
        saved: req.query.saved === "1",
        deleted: req.query.deleted === "1",
        deleteBlocked: req.query.delete_blocked === "1",
        csrfToken: req.csrfToken()
      });
    },

    async createCustomer(req, res) {
      await service.createCustomer({
        name: req.body.name,
        customerType: req.body.customer_type,
        notes: req.body.notes
      });
      return res.redirect("/admin/report-service/customers?created=1");
    },

    async createSite(req, res) {
      await service.createSite({
        customerId: req.body.customer_id,
        siteName: req.body.site_name,
        siteCode: req.body.site_code,
        location: req.body.location,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        notes: req.body.notes
      });
      return res.redirect("/admin/report-service/customers?created=1");
    },

    async updateCustomer(req, res) {
      const id = Number(req.params.id);
      await repo.updateCustomer(id, {
        name: sanitizeInput(req.body.name),
        customerType: req.body.customer_type,
        notes: sanitizeInput(req.body.notes)
      });
      return res.redirect("/admin/report-service/customers?saved=1");
    },

    async updateSite(req, res) {
      const id = Number(req.params.id);
      const lat = req.body.latitude !== "" && req.body.latitude != null ? Number(req.body.latitude) : null;
      const lng = req.body.longitude !== "" && req.body.longitude != null ? Number(req.body.longitude) : null;
      await repo.updateSite(id, {
        siteName: sanitizeInput(req.body.site_name),
        siteCode: sanitizeInput(req.body.site_code),
        location: sanitizeInput(req.body.location),
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
        notes: sanitizeInput(req.body.notes)
      });
      return res.redirect("/admin/report-service/customers?saved=1");
    },

    async deleteCustomer(req, res) {
      const id = Number(req.params.id);
      try {
        await repo.deleteCustomer(id);
        return res.redirect("/admin/report-service/customers?deleted=1");
      } catch (err) {
        if (err && err.code === "23503") {
          return res.redirect("/admin/report-service/customers?delete_blocked=1");
        }
        throw err;
      }
    },

    async deleteSite(req, res) {
      const id = Number(req.params.id);
      await repo.deleteSite(id);
      return res.redirect("/admin/report-service/customers?deleted=1");
    },

    async listEquipments(req, res) {
      const [equipments, customers, sites] = await Promise.all([
        repo.listEquipments(),
        repo.listCustomers(),
        repo.listSites()
      ]);
      return res.render("report-service/equipments", {
        pageTitle: "Service Report - Equipamentos",
        equipments,
        customers,
        sites,
        created: req.query.created === "1",
        updated: req.query.updated === "1",
        csrfToken: req.csrfToken()
      });
    },

    async listSpareParts(req, res) {
      const [spareParts, equipments, customers] = await Promise.all([
        repo.listSpareParts(),
        repo.listEquipments(),
        repo.listCustomers()
      ]);
      const selectedEquipmentId = Number(req.query.equipment_id || 0);
      let selectedCustomerId = Number(req.query.customer_id || 0);
      const hasSelectedEquipment = Number.isInteger(selectedEquipmentId) && selectedEquipmentId > 0;
      let selectedEquipment = hasSelectedEquipment ? await repo.getEquipmentById(selectedEquipmentId) : null;
      if ((!Number.isInteger(selectedCustomerId) || selectedCustomerId <= 0) && selectedEquipment) {
        selectedCustomerId = Number(selectedEquipment.customer_id || 0);
      }
      if (
        selectedEquipment &&
        Number.isInteger(selectedCustomerId) &&
        selectedCustomerId > 0 &&
        Number(selectedEquipment.customer_id) !== selectedCustomerId
      ) {
        selectedEquipment = null;
      }

      const filteredEquipments = Number.isInteger(selectedCustomerId) && selectedCustomerId > 0
        ? equipments.filter((item) => Number(item.customer_id) === selectedCustomerId)
        : equipments;

      const linkedSpareParts = selectedEquipment ? await repo.listSparePartsByEquipment(selectedEquipment.id) : [];
      const linkedIds = new Set(linkedSpareParts.map((item) => Number(item.id)));
      const linkedPns = new Set(
        linkedSpareParts
          .map((item) => normalizePartNumberToken(item.part_number))
          .filter(Boolean)
      );
      const availableSpareParts = selectedEquipment
        ? spareParts.filter((item) => {
            if (linkedIds.has(Number(item.id))) return false;
            const pn = normalizePartNumberToken(item.part_number);
            if (pn && linkedPns.has(pn)) return false;
            return true;
          })
        : spareParts;

      return res.render("report-service/spare-parts", {
        pageTitle: "Service Report - Spare Parts",
        spareParts,
        equipments: filteredEquipments,
        allEquipments: equipments,
        customers,
        selectedEquipment,
        selectedEquipmentId: selectedEquipment ? selectedEquipment.id : 0,
        selectedCustomerId: Number.isInteger(selectedCustomerId) && selectedCustomerId > 0 ? selectedCustomerId : 0,
        linkedSpareParts,
        availableSpareParts,
        created: req.query.created === "1",
        saved: req.query.saved === "1",
        deleted: req.query.deleted === "1",
        linked: req.query.linked === "1",
        unlinked: req.query.unlinked === "1",
        quantitySaved: req.query.qty_saved === "1",
        autoLinkedCount: Math.max(0, Number(req.query.auto_linked || 0)),
        autoFamilyNoMatch: req.query.auto_no_match === "1",
        error: sanitizeInput(req.query.error || ""),
        csrfToken: req.csrfToken()
      });
    },

    async createSparePart(req, res) {
      const description = sanitizeInput(req.body.description);
      if (!description) {
        return res.status(422).send("Descricao e obrigatoria.");
      }

      try {
        await repo.createSparePart({
          description,
          manufacturer: sanitizeInput(req.body.manufacturer),
          equipmentModel: sanitizeInput(req.body.equipment_model),
          partNumber: sanitizeInput(req.body.part_number),
          leadTime: sanitizeInput(req.body.lead_time),
          isObsolete: req.body.is_obsolete === "on" || req.body.is_obsolete === "true",
          replacedByPartNumber: sanitizeInput(req.body.replaced_by_part_number),
          equipmentFamily: sanitizeInput(req.body.equipment_family)
        });
      } catch (err) {
        if (err.code === "pn_duplicate") {
          return res.redirect("/admin/report-service/spare-parts?error=pn_duplicate");
        }
        throw err;
      }
      return res.redirect("/admin/report-service/spare-parts?created=1");
    },

    async updateSparePart(req, res) {
      const sparePartId = Number(req.params.id);
      if (!Number.isInteger(sparePartId) || sparePartId <= 0) {
        return res.status(400).send("Spare-part invalido.");
      }
      const description = sanitizeInput(req.body.description);
      if (!description) {
        return res.status(422).send("Descricao e obrigatoria.");
      }

      let updated;
      try {
        updated = await repo.updateSparePart(sparePartId, {
          description,
          manufacturer: sanitizeInput(req.body.manufacturer),
          equipmentModel: sanitizeInput(req.body.equipment_model),
          partNumber: sanitizeInput(req.body.part_number),
          leadTime: sanitizeInput(req.body.lead_time),
          isObsolete: req.body.is_obsolete === "on" || req.body.is_obsolete === "true",
          replacedByPartNumber: sanitizeInput(req.body.replaced_by_part_number),
          equipmentFamily: sanitizeInput(req.body.equipment_family)
        });
      } catch (err) {
        if (err.code === "pn_duplicate") {
          return res.redirect("/admin/report-service/spare-parts?error=pn_duplicate");
        }
        throw err;
      }
      if (!updated) {
        return res.status(404).send("Spare-part nao encontrado.");
      }
      return res.redirect("/admin/report-service/spare-parts?saved=1");
    },

    async deleteSparePart(req, res) {
      const sparePartId = Number(req.params.id);
      if (!Number.isInteger(sparePartId) || sparePartId <= 0) {
        return res.status(400).send("Spare-part invalido.");
      }
      await repo.deleteSparePart(sparePartId);
      return res.redirect("/admin/report-service/spare-parts?deleted=1");
    },

    async extractSparePartsFromPdf(req, res) {
      if (!extractSparePartsFromDocument) {
        return res.status(503).json({ ok: false, message: "Servico de IA nao disponivel." });
      }
      const fileBase64 = String(req.body.fileBase64 || "").trim();
      if (!fileBase64) {
        return res.status(422).json({ ok: false, message: "Arquivo PDF invalido ou vazio." });
      }
      let fileBuffer;
      try {
        fileBuffer = Buffer.from(fileBase64, "base64");
      } catch (_e) {
        return res.status(422).json({ ok: false, message: "Falha ao decodificar o arquivo." });
      }
      if (!fileBuffer.length) {
        return res.status(422).json({ ok: false, message: "Arquivo PDF invalido ou vazio." });
      }
      const fileName = sanitizeInput(String(req.body.fileName || "documento.pdf"));
      const mimeType = String(req.body.mimeType || "application/pdf").split(";")[0].trim() || "application/pdf";
      const promptTemplate = sanitizeInput(String(req.body.promptTemplate || ""));

      const result = await extractSparePartsFromDocument({
        fileBuffer,
        fileName,
        mimeType,
        promptTemplate
      });

      return res.json({ ok: true, spareParts: result.spareParts, count: result.spareParts.length });
    },

    async bulkImportSpareParts(req, res) {
      let items;
      try {
        items = Array.isArray(req.body.spare_parts) ? req.body.spare_parts : JSON.parse(req.body.spare_parts || "[]");
      } catch (_e) {
        return res.status(422).json({ ok: false, message: "JSON de spare parts invalido." });
      }
      if (!Array.isArray(items) || !items.length) {
        return res.status(422).json({ ok: false, message: "Nenhum spare part para importar." });
      }

      const equipmentId = Number(req.body.equipment_id || 0);
      const hasEquipment = Number.isInteger(equipmentId) && equipmentId > 0;

      const normalized = items.map((item) => ({
        description: sanitizeInput(String(item.description || "")).trim(),
        manufacturer: sanitizeInput(String(item.manufacturer || "")).trim(),
        partNumber: sanitizeInput(String(item.part_number || "")).trim(),
        equipmentFamily: sanitizeInput(String(item.equipment_family || "")).trim(),
        equipmentModel: sanitizeInput(String(item.equipment_model || "")).trim(),
        leadTime: sanitizeInput(String(item.lead_time || "")).trim(),
        isObsolete: item.is_obsolete === true || String(item.is_obsolete).toLowerCase() === "true",
        replacedByPartNumber: sanitizeInput(String(item.replaced_by_part_number || "")).trim()
      })).filter((item) => item.description);

      if (!normalized.length) {
        return res.status(422).json({ ok: false, message: "Nenhum spare part com descricao valida para importar." });
      }

      const result = await repo.bulkCreateSpareParts(normalized);

      let linked = 0;
      if (hasEquipment) {
        // IDs recém-inseridos
        const newIds = (result.items || []).map((item) => Number(item.id));

        // IDs de PNs já existentes que foram pulados no bulk (precisamos vincular também)
        const allPartNumbers = normalized
          .map((item) => String(item.partNumber || "").trim())
          .filter(Boolean);
        const existingRows = allPartNumbers.length > 0
          ? await repo.getSparePartsByPartNumbers(allPartNumbers)
          : [];
        const existingIds = existingRows.map((r) => Number(r.id));

        const allIds = [...new Set([...newIds, ...existingIds])];
        for (const id of allIds) {
          // eslint-disable-next-line no-await-in-loop
          await repo.linkSparePartToEquipmentIfMissing(equipmentId, id);
          linked++;
        }
      }

      return res.json({
        ok: true,
        inserted: result.inserted,
        skipped: result.skipped,
        skippedIntraJson: result.skippedIntraJson,
        skippedExisting: result.skippedExisting,
        linked
      });
    },

    async importLinkedSpareParts(req, res) {
      const equipmentId = Number(req.body.equipment_id);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        return res.status(422).json({ ok: false, message: "Equipamento inválido." });
      }

      const equipment = await repo.getEquipmentById(equipmentId);
      if (!equipment) {
        return res.status(404).json({ ok: false, message: "Equipamento não encontrado." });
      }

      let rows;
      try {
        rows = Array.isArray(req.body.rows) ? req.body.rows : JSON.parse(req.body.rows || "[]");
      } catch (_e) {
        return res.status(422).json({ ok: false, message: "Dados inválidos." });
      }

      if (!Array.isArray(rows) || !rows.length) {
        return res.status(422).json({ ok: false, message: "Nenhuma linha para importar." });
      }

      const normalized = rows.map((r) => ({
        description: sanitizeInput(String(r.description || "")).trim(),
        manufacturer: sanitizeInput(String(r.manufacturer || "")).trim(),
        partNumber: sanitizeInput(String(r.part_number || "")).trim(),
        equipmentModel: sanitizeInput(String(r.equipment_model || "")).trim(),
        equipmentFamily: sanitizeInput(String(r.equipment_family || "")).trim(),
        leadTime: sanitizeInput(String(r.lead_time || "")).trim(),
        replacedByPartNumber: sanitizeInput(String(r.replaced_by_part_number || "")).trim(),
        isObsolete: r.is_obsolete === true || String(r.is_obsolete || "").toLowerCase() === "true"
          || String(r.is_obsolete || "").toLowerCase() === "sim",
        quantity: Number.isInteger(Number(r.quantity)) && Number(r.quantity) > 0 ? Number(r.quantity) : 1
      })).filter((r) => r.description);

      if (!normalized.length) {
        return res.status(422).json({ ok: false, message: "Nenhuma linha com descrição válida." });
      }

      const result = await repo.bulkUpsertLinkedSpareParts(equipmentId, normalized);

      return res.json({
        ok: true,
        updated: result.updated,
        inserted: result.inserted,
        linked: result.linked
      });
    },

    async getSparePartsAiConfig(_req, res) {
      return res.json({
        ok: true,
        defaultPrompt: getSparePartsDefaultPrompt ? getSparePartsDefaultPrompt() : "",
        jsonSchema: getSparePartsJsonSchema ? getSparePartsJsonSchema() : ""
      });
    },

    async linkSparePartToEquipment(req, res) {
      const equipmentId = Number(req.body.equipment_id);
      const sparePartId = Number(req.body.spare_part_id);
      const quantity = Number(req.body.quantity || 1);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        return res.redirect("/admin/report-service/spare-parts?error=equipment_invalid");
      }
      if (!Number.isInteger(sparePartId) || sparePartId <= 0) {
        return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&error=spare_part_invalid`);
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&error=quantity_invalid`);
      }

      const [equipment, sparePart] = await Promise.all([
        repo.getEquipmentById(equipmentId),
        repo.getSparePartById(sparePartId)
      ]);
      if (!equipment) {
        return res.redirect("/admin/report-service/spare-parts?error=equipment_not_found");
      }
      if (!sparePart) {
        return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&error=spare_part_not_found`);
      }

      // Block if equipment already has a spare part with the same PN
      if (sparePart.part_number) {
        const alreadyLinked = await repo.listSparePartsByEquipment(equipmentId);
        const pnLower = normalizePartNumberToken(sparePart.part_number);
        const conflict = alreadyLinked.find(
          (item) => normalizePartNumberToken(item.part_number) === pnLower
        );
        if (conflict) {
          return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&error=pn_duplicate`);
        }
      }

      await repo.linkSparePartToEquipment(equipmentId, sparePartId, quantity);
      return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&linked=1`);
    },

    async unlinkSparePartFromEquipment(req, res) {
      const equipmentId = Number(req.params.equipmentId);
      const sparePartId = Number(req.params.sparePartId);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        return res.redirect("/admin/report-service/spare-parts?error=equipment_invalid");
      }
      if (!Number.isInteger(sparePartId) || sparePartId <= 0) {
        return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&error=spare_part_invalid`);
      }

      await repo.unlinkSparePartFromEquipment(equipmentId, sparePartId);
      return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&unlinked=1`);
    },

    async updateSparePartQuantityByEquipment(req, res) {
      const equipmentId = Number(req.params.equipmentId);
      const sparePartId = Number(req.params.sparePartId);
      const quantity = Number(req.body.quantity || 0);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        return res.redirect("/admin/report-service/spare-parts?error=equipment_invalid");
      }
      if (!Number.isInteger(sparePartId) || sparePartId <= 0) {
        return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&error=spare_part_invalid`);
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&error=quantity_invalid`);
      }

      const updated = await repo.updateSparePartQuantityByEquipment(equipmentId, sparePartId, quantity);
      if (!updated) {
        return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&error=spare_part_not_found`);
      }
      return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&qty_saved=1`);
    },

    async autoLinkSparePartsByFamily(req, res) {
      const equipmentId = Number(req.body.equipment_id);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        return res.redirect("/admin/report-service/spare-parts?error=equipment_invalid");
      }
      const equipment = await repo.getEquipmentById(equipmentId);
      if (!equipment) {
        return res.redirect("/admin/report-service/spare-parts?error=equipment_not_found");
      }

      const linkMode = sanitizeInput(req.body.link_mode) === "model" ? "model" : "family";

      // Resolve the reference value from the equipment based on chosen mode:
      // - family: matches spare.equipment_model against equipment.model_family (existing behaviour)
      // - model:  matches spare.equipment_model against equipment.type (direct model-to-model)
      const referenceValue = linkMode === "model"
        ? sanitizeInput(equipment.type || "")
        : sanitizeInput(equipment.model_family || "");

      if (!referenceValue) {
        const errorKey = linkMode === "model" ? "model_empty" : "family_empty";
        return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&error=${errorKey}`);
      }

      const spareParts = await repo.listSpareParts();

      // family mode: compare spare.equipment_family against equipment.model_family
      // model mode:  compare spare.equipment_model against equipment.type
      const matching = spareParts.filter((item) => {
        const spareValue = linkMode === "model"
          ? sanitizeInput(item.equipment_model || "")
          : sanitizeInput(item.equipment_family || "");
        return isModelMatch(spareValue, referenceValue);
      });

      if (!matching.length) {
        return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&auto_no_match=1&link_mode=${linkMode}`);
      }

      const alreadyLinkedRows = await repo.listSparePartsByEquipment(equipmentId);
      const alreadyLinkedIds = new Set(alreadyLinkedRows.map((row) => Number(row.id)));
      const alreadyLinkedPns = new Set(
        alreadyLinkedRows
          .map((row) => normalizePartNumberToken(row.part_number))
          .filter(Boolean)
      );
      let linkedCount = 0;
      for (const item of matching) {
        const itemId = Number(item.id);
        const itemPn = normalizePartNumberToken(item.part_number);
        if (!alreadyLinkedIds.has(itemId) && (!itemPn || !alreadyLinkedPns.has(itemPn))) {
          // eslint-disable-next-line no-await-in-loop
          await repo.linkSparePartToEquipmentIfMissing(equipmentId, itemId, 1);
          alreadyLinkedIds.add(itemId);
          if (itemPn) alreadyLinkedPns.add(itemPn);
          linkedCount += 1;
        }
      }
      return res.redirect(`/admin/report-service/spare-parts?equipment_id=${equipmentId}&auto_linked=${linkedCount}&link_mode=${linkMode}`);
    },

    async createEquipment(req, res) {
      if (!hasValidRequiredFk(req.body.customer_id)) {
        return res.status(422).send("Cliente e obrigatorio.");
      }
      if (!hasValidRequiredFk(req.body.site_id)) {
        return res.status(422).send("Site e obrigatorio.");
      }
      if (!await isSiteLinkedToCustomer(req.body.customer_id, req.body.site_id)) {
        return res.status(422).send("Site nao pertence ao cliente informado.");
      }

      await service.createEquipment({
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        type: req.body.type,
        yearOfManufacture: req.body.year_of_manufacture,
        serialNumber: req.body.serial_number,
        power: req.body.power,
        ratedAcInputVoltage: req.body.rated_ac_input_voltage,
        inputFrequency: req.body.input_frequency,
        ratedDcVoltage: req.body.rated_dc_voltage,
        ratedAcOutputVoltage: req.body.rated_ac_output_voltage,
        outputFrequency: req.body.output_frequency,
        degreeOfProtection: req.body.degree_of_protection,
        mainLabel: req.body.main_label,
        dtNumber: req.body.dt_number,
        tagNumber: req.body.tag_number,
        manufacturer: req.body.manufacturer,
        modelFamily: req.body.model_family,
        notes: req.body.notes
      });
      return res.redirect("/admin/report-service/equipments?created=1");
    },

    async updateEquipment(req, res) {
      const equipmentId = Number(req.params.id);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        return res.status(400).send("Equipamento invalido.");
      }
      if (!hasValidRequiredFk(req.body.customer_id)) {
        return res.status(422).send("Cliente e obrigatorio.");
      }
      if (!hasValidRequiredFk(req.body.site_id)) {
        return res.status(422).send("Site e obrigatorio.");
      }
      if (!await isSiteLinkedToCustomer(req.body.customer_id, req.body.site_id)) {
        return res.status(422).send("Site nao pertence ao cliente informado.");
      }

      const updated = await service.updateEquipment(equipmentId, {
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        type: req.body.type,
        yearOfManufacture: req.body.year_of_manufacture,
        serialNumber: req.body.serial_number,
        power: req.body.power,
        ratedAcInputVoltage: req.body.rated_ac_input_voltage,
        inputFrequency: req.body.input_frequency,
        ratedDcVoltage: req.body.rated_dc_voltage,
        ratedAcOutputVoltage: req.body.rated_ac_output_voltage,
        outputFrequency: req.body.output_frequency,
        degreeOfProtection: req.body.degree_of_protection,
        mainLabel: req.body.main_label,
        dtNumber: req.body.dt_number,
        tagNumber: req.body.tag_number,
        manufacturer: req.body.manufacturer,
        modelFamily: req.body.model_family,
        notes: req.body.notes
      });

      if (!updated) {
        return res.status(404).send("Equipamento nao encontrado.");
      }
      return res.redirect("/admin/report-service/equipments?updated=1");
    },

    async updateEquipmentInline(req, res) {
      const equipmentId = Number(req.params.id);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        return res.status(400).json({ ok: false, error: "Equipamento invalido." });
      }
      if (!hasValidRequiredFk(req.body.customer_id)) {
        return res.status(422).json({ ok: false, error: "Cliente e obrigatorio." });
      }
      if (!hasValidRequiredFk(req.body.site_id)) {
        return res.status(422).json({ ok: false, error: "Site e obrigatorio." });
      }
      if (!await isSiteLinkedToCustomer(req.body.customer_id, req.body.site_id)) {
        return res.status(422).json({ ok: false, error: "Site nao pertence ao cliente informado." });
      }

      const updated = await service.updateEquipment(equipmentId, {
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        type: req.body.type,
        yearOfManufacture: req.body.year_of_manufacture,
        serialNumber: req.body.serial_number,
        power: req.body.power,
        ratedAcInputVoltage: req.body.rated_ac_input_voltage,
        inputFrequency: req.body.input_frequency,
        ratedDcVoltage: req.body.rated_dc_voltage,
        ratedAcOutputVoltage: req.body.rated_ac_output_voltage,
        outputFrequency: req.body.output_frequency,
        degreeOfProtection: req.body.degree_of_protection,
        mainLabel: req.body.main_label,
        dtNumber: req.body.dt_number,
        tagNumber: req.body.tag_number,
        manufacturer: req.body.manufacturer,
        modelFamily: req.body.model_family,
        notes: req.body.notes
      });

      if (!updated) {
        return res.status(404).json({ ok: false, error: "Equipamento nao encontrado." });
      }

      return res.status(200).json({ ok: true, id: updated.id });
    },

    async createEquipmentInline(req, res) {
      if (!hasValidRequiredFk(req.body.customer_id)) {
        return res.status(422).json({ ok: false, error: "Cliente e obrigatorio." });
      }
      if (!hasValidRequiredFk(req.body.site_id)) {
        return res.status(422).json({ ok: false, error: "Site e obrigatorio." });
      }
      if (!await isSiteLinkedToCustomer(req.body.customer_id, req.body.site_id)) {
        return res.status(422).json({ ok: false, error: "Site nao pertence ao cliente informado." });
      }

      const created = await service.createEquipment({
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        type: req.body.type || "Novo Equipamento",
        yearOfManufacture: req.body.year_of_manufacture,
        serialNumber: req.body.serial_number,
        power: req.body.power,
        ratedAcInputVoltage: req.body.rated_ac_input_voltage,
        inputFrequency: req.body.input_frequency,
        ratedDcVoltage: req.body.rated_dc_voltage,
        ratedAcOutputVoltage: req.body.rated_ac_output_voltage,
        outputFrequency: req.body.output_frequency,
        degreeOfProtection: req.body.degree_of_protection,
        mainLabel: req.body.main_label,
        dtNumber: req.body.dt_number,
        tagNumber: req.body.tag_number,
        manufacturer: req.body.manufacturer,
        modelFamily: req.body.model_family,
        notes: req.body.notes
      });

      return res.status(201).json({ ok: true, id: created.id });
    },

    async deleteEquipmentInline(req, res) {
      const equipmentId = Number(req.params.id);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        return res.status(400).json({ ok: false, error: "Equipamento invalido." });
      }

      try {
        const deleted = await service.deleteEquipment(equipmentId);
        if (!deleted) {
          return res.status(404).json({ ok: false, error: "Equipamento nao encontrado." });
        }
        return res.status(200).json({ ok: true });
      } catch (err) {
        if (err && err.code === "23503") {
          return res.status(409).json({
            ok: false,
            error: "Nao foi possivel remover: equipamento vinculado a uma ou mais ordens de servico."
          });
        }
        if (err && err.statusCode === 404) {
          return res.status(404).json({ ok: false, error: "Equipamento nao encontrado." });
        }
        throw err;
      }
    },

    async orderEditor(req, res) {
      const orderId = Number(req.params.id);
      const [data, allGlobalTechnicians] = await Promise.all([
        loadOrderEditorData(orderId),
        repo.listGlobalTechnicians()
      ]);
      if (!data) return res.status(404).send("OS nao encontrada.");
      const orderView = withServiceOrderDisplay(data.order);
      const reportConfig = await getReportConfigSettings();
      const osValidation = buildOrderValidationSummary(data);
      return res.render("report-service/order-editor", {
        pageTitle: `Service Report - ${orderView.service_order_display || orderView.service_order_code || "-"}`,
        ...data,
        order: orderView,
        reportConfig,
        allGlobalTechnicians,
        sectionDefinitions: SECTION_DEFINITIONS,
        quillSectionToolbar: QUILL_SECTION_TOOLBAR,
        quillSectionTitleToolbar: QUILL_SECTION_TITLE_TOOLBAR,
        quillSectionFormats: QUILL_SECTION_FORMATS,
        quillSectionTitleFormats: QUILL_SECTION_TITLE_FORMATS,
        componentCategories: COMPONENT_CATEGORIES,
        signerTypes: SIGNER_TYPES,
        saved: req.query.saved === "1",
        editLocked: req.query.edit_locked === "1",
        signLocked: req.query.sign_locked === "1",
        validationSuccess: req.query.validated === "1",
        validationError: req.query.validation_error === "1",
        revalidated: req.query.revalidated === "1",
        revalidateError: sanitizeInput(req.query.revalidate_error).toLowerCase(),
        osEmailSent: req.query.os_email_sent === "1",
        osEmailError: sanitizeInput(req.query.os_email_error).toLowerCase(),
        osValidation,
        timesheetError: null,
        csrfToken: req.csrfToken()
      });
    },

    async reportOrderEditor(req, res) {
      const orderId = Number(req.params.id);
      const data = await loadOrderEditorData(orderId);
      if (!data) return res.status(404).send("OS nao encontrada.");
      const orderView = withServiceOrderDisplay(data.order);
      const requestedTemplateKey = sanitizeInput(req.query.template_key);
      const { reportConfig, templateKey } = await resolveRenderConfig(requestedTemplateKey, null);
      const osValidation = buildOrderValidationSummary(data);
      const signRequestGuard = buildElectronicSignatureLinkGuard(data);
      let signRequests = [];
      try { signRequests = await repo.listSignRequestsByReportId(data.report.id); } catch (_e) { /* migration pendente */ }
      const canSendSignedReport = hasSignedApproval(signRequests, data.signatures);
      const emailErrorMap = {
        not_signed: "O envio por e-mail so e permitido apos o relatorio estar assinado.",
        token_not_found: "Nao foi possivel gerar o link assinado do relatorio.",
        invalid_to: "Informe ao menos 1 destinatario valido no campo Para.",
        invalid_cc: "Existe e-mail invalido no campo CC.",
        smtp: "Configuracao SMTP incompleta no modulo Service Report.",
        send_failed: "Falha ao enviar e-mail do relatorio assinado."
      };
      const emailErrorKey = sanitizeInput(req.query.email_error).toLowerCase();
      const signLinkEmailErrorMap = {
        invalid_signer_email: "Informe um e-mail valido para o signatario.",
        smtp: "Configuracao SMTP incompleta no modulo Service Report.",
        send_failed: "Link criado, mas houve falha ao enviar e-mail para o signatario.",
        translate_failed: "Falha ao traduzir o relatorio antes de enviar para assinatura.",
        ai_unavailable: "Servico de IA indisponivel para traducao."
      };
      const signLinkEmailErrorKey = sanitizeInput(req.query.sign_link_email_error).toLowerCase();
      const reportLanguage = normalizeReportLanguage(data.report.document_language, "pt");
      const translationErrorMap = {
        invalid_language: "Idioma de traducao invalido.",
        ai_unavailable: "Servico de IA indisponivel para traducao.",
        failed: "Falha ao traduzir e salvar o relatorio."
      };
      const translationErrorKey = sanitizeInput(req.query.translate_error).toLowerCase();
      const translatedTo = normalizeReportLanguage(req.query.translated_to, "");
      return res.render("report-service/report-editor", {
        pageTitle: `Editar Relatorio - ${orderView.service_order_display || orderView.service_order_code || "-"}`,
        order: orderView,
        report: data.report,
        sections: data.sections,
        images: data.images,
        orderEquipments: data.orderEquipments,
        dailyLogs: data.dailyLogs,
        signatures: data.signatures,
        signRequests,
        reportConfig,
        templateKey,
        templatePreviewRoute: buildTemplatePreviewRoute(orderId, templateKey),
        quillSectionToolbar: QUILL_SECTION_TOOLBAR,
        quillSectionTitleToolbar: QUILL_SECTION_TITLE_TOOLBAR,
        quillSectionFormats: QUILL_SECTION_FORMATS,
        quillSectionTitleFormats: QUILL_SECTION_TITLE_FORMATS,
        saved: req.query.saved === "1",
        editLocked: req.query.edit_locked === "1",
        signLocked: req.query.sign_locked === "1",
        validationSuccess: req.query.validated === "1",
        validationError: req.query.validation_error === "1",
        revalidated: req.query.revalidated === "1",
        revalidateError: sanitizeInput(req.query.revalidate_error).toLowerCase(),
        osValidation,
        signRequestGuard,
        signLinkBlocked: req.query.sign_link_blocked === "1",
        signedLinkCreated: req.query.signed_link === "1",
        signLinkEmailSent: req.query.sign_link_email_sent === "1",
        signLinkEmailError: signLinkEmailErrorMap[signLinkEmailErrorKey] || "",
        signRequestUpdated: req.query.sign_request_updated === "1",
        signRequestEditBlocked: req.query.sign_request_edit_blocked === "1",
        reportLanguages: REPORT_LANGUAGES,
        reportLanguage,
        translated: req.query.translated === "1",
        translatedTo,
        translationError: translationErrorMap[translationErrorKey] || "",
        canSendSignedReport,
        emailSent: req.query.email_sent === "1",
        emailError: emailErrorMap[emailErrorKey] || "",
        csrfToken: req.csrfToken()
      });
    },

    async signReportPage(req, res) {
      const orderId = Number(req.params.id);
      const data = await loadOrderEditorData(orderId);
      if (!data) return res.status(404).send("OS nao encontrada.");
      const orderView = withServiceOrderDisplay(data.order);
      const isOrderValid = String(data.order.status || "").toLowerCase() === "valid";
      if (!isOrderValid) {
        return res.redirect(`/admin/report-service/orders/${orderId}?sign_locked=1`);
      }
      const vextromSignatures = (data.signatures || []).filter((item) => String(item.signer_type || "") === "vextrom_technician");
      return res.render("report-service/sign-report", {
        pageTitle: `Assinar Relatorio - ${orderView.service_order_display || orderView.service_order_code || "-"}`,
        order: orderView,
        report: data.report,
        technicians: data.technicians || [],
        signatures: vextromSignatures,
        signed: req.query.signed === "1",
        signError: req.query.error === "1",
        csrfToken: req.csrfToken()
      });
    },

    async signReport(req, res) {
      const orderId = Number(req.params.id);
      const data = await loadOrderEditorData(orderId);
      if (!data) return res.status(404).send("OS nao encontrada.");
      const isOrderValid = String(data.order.status || "").toLowerCase() === "valid";
      if (!isOrderValid) {
        return res.redirect(`/admin/report-service/orders/${orderId}?sign_locked=1`);
      }

      const signatureData = String(req.body.signature_data || "").trim();
      if (!signatureData || signatureData === "data:,") {
        return res.redirect(`/admin/report-service/orders/${orderId}/sign-report?error=1`);
      }

      await service.createSignature(data.report.id, {
        signerType: "vextrom_technician",
        signerName: req.body.signer_name,
        signerRole: req.body.signer_role,
        signerCompany: req.body.signer_company,
        signatureData
      });
      return res.redirect(`/admin/report-service/orders/${orderId}/sign-report?signed=1`);
    },

    async reportConfigPage(req, res) {
      const reportConfig = await getReportConfigSettings();
      return res.render("report-service/config", {
        pageTitle: "Config Report - Service Report",
        reportConfig,
        saved: req.query.saved === "1",
        csrfToken: req.csrfToken()
      });
    },

    async saveReportConfig(req, res) {
      await saveReportConfigSettings({
        logoVextrom: sanitizeInput(req.body.logo_vextrom),
        logoChloride: sanitizeInput(req.body.logo_chloride),
        logoCover: sanitizeInput(req.body.logo_cover),
        templateKey: sanitizeInput(req.body.template_key),
        footerHtml: req.body.footer_html !== undefined ? String(req.body.footer_html) : undefined,
        defaultScopeHtml: req.body.default_scope_html !== undefined
          ? sanitizeReportSectionHtml(req.body.default_scope_html)
          : undefined,
        defaultRecommendationsHtml: req.body.default_recommendations_html !== undefined
          ? sanitizeReportSectionHtml(req.body.default_recommendations_html)
          : undefined
      });
      return res.redirect("/admin/report-service/config?saved=1");
    },

    async uploadConfigLogo(req, res) {
      const brand = String(req.headers["x-logo-brand"] || "").toLowerCase();
      if (!["vextrom", "chloride", "cover"].includes(brand)) {
        return res.status(400).json({ ok: false, error: "Brand invalido. Use 'vextrom', 'chloride' ou 'cover'." });
      }

      let fileNameRaw = "logo";
      try {
        fileNameRaw = decodeURIComponent(String(req.headers["x-file-name"] || "logo"));
      } catch (_err) {
        fileNameRaw = String(req.headers["x-file-name"] || "logo");
      }
      fileNameRaw = sanitizeInput(fileNameRaw);
      const fileNameBase = path.basename(fileNameRaw).replace(/[^a-zA-Z0-9._-]/g, "") || "logo";
      const extFromName = path.extname(fileNameBase).toLowerCase();
      const mime = String(req.headers["content-type"] || "").toLowerCase();
      const extFromMime = mime.includes("svg") ? ".svg" : mime.includes("png") ? ".png" : mime.includes("jpeg") || mime.includes("jpg") ? ".jpg" : "";
      const ext = [".svg", ".png", ".jpg", ".jpeg"].includes(extFromName) ? extFromName : extFromMime;
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

      if (!ext || !buffer.length) {
        return res.status(400).json({ ok: false, error: "Arquivo invalido. Envie PNG, JPG ou SVG." });
      }

      const targetDir = path.join(process.cwd(), "docs", "report", "img", "logos");
      await fs.promises.mkdir(targetDir, { recursive: true });
      const unique = crypto.randomBytes(6).toString("hex");
      const finalName = `logo-${brand}-${Date.now()}-${unique}${ext === ".jpeg" ? ".jpg" : ext}`;
      await fs.promises.writeFile(path.join(targetDir, finalName), buffer);

      return res.status(201).json({ ok: true, data: { filePath: `/docs/report/img/logos/${finalName}` } });
    },

    async uploadConfigImage(req, res) {
      let fileNameRaw = "imagem";
      try {
        fileNameRaw = decodeURIComponent(String(req.headers["x-file-name"] || "imagem"));
      } catch (_err) {
        fileNameRaw = String(req.headers["x-file-name"] || "imagem");
      }
      fileNameRaw = sanitizeInput(fileNameRaw);
      const fileNameBase = path.basename(fileNameRaw).replace(/[^a-zA-Z0-9._-]/g, "") || "imagem";
      const extFromName = path.extname(fileNameBase).toLowerCase();
      const mime = String(req.headers["content-type"] || "").toLowerCase();
      const extFromMime = mime.includes("png")
        ? ".png"
        : mime.includes("jpeg") || mime.includes("jpg")
          ? ".jpg"
          : mime.includes("webp")
            ? ".webp"
            : mime.includes("gif")
              ? ".gif"
              : "";
      const ext = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extFromName) ? extFromName : extFromMime;
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      if (!ext || !buffer.length) {
        return res.status(400).json({ ok: false, error: "Arquivo de imagem invalido." });
      }
      const targetDir = path.join(process.cwd(), "docs", "report", "img");
      await fs.promises.mkdir(targetDir, { recursive: true });
      const fileSafeBase = path.basename(fileNameBase, extFromName || path.extname(fileNameBase)).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "imagem";
      const unique = crypto.randomBytes(6).toString("hex");
      const finalName = `config-${Date.now()}-${fileSafeBase}-${unique}${ext === ".jpeg" ? ".jpg" : ext}`;
      await fs.promises.writeFile(path.join(targetDir, finalName), buffer);
      return res.status(201).json({ ok: true, data: { filePath: finalName } });
    },

    async attachEquipment(req, res) {
      const orderId = Number(req.params.id);
      const order = await ensureOrderEditable(req, res, orderId);
      if (!order) return;
      const equipmentId = Number(req.body.equipment_id);
      if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
        return res.status(422).send("Equipamento invalido.");
      }

      const equipment = await repo.getEquipmentById(equipmentId);
      if (!equipment) {
        return res.status(404).send("Equipamento nao encontrado.");
      }

      const sameCustomer = Number(equipment.customer_id) === Number(order.customer_id);
      const sameSite = Number.isInteger(Number(order.site_id)) && Number(order.site_id) > 0
        ? Number(equipment.site_id) === Number(order.site_id)
        : true;
      if (!sameCustomer || !sameSite) {
        return res.status(422).send("Equipamento nao pertence ao cliente/site da OS.");
      }

      await repo.attachEquipmentToOrder(orderId, equipmentId, sanitizeInput(req.body.notes));
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async detachEquipment(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const equipmentId = Number(req.params.equipmentId);
      await repo.detachEquipmentFromOrder(orderId, equipmentId);
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async validateOrder(req, res) {
      const orderId = Number(req.params.id);
      const data = await loadOrderEditorData(orderId);
      if (!data) return res.status(404).send("OS nao encontrada.");

      const referer = String(req.headers.referer || "");
      const fromReportEditor = referer.includes("/report-editor");
      const redirectBase = fromReportEditor
        ? `/admin/report-service/orders/${orderId}/report-editor`
        : `/admin/report-service/orders/${orderId}`;

      if (isOrderApproved(data.order)) {
        return res.redirect(`${redirectBase}?edit_locked=1`);
      }

      const summary = buildOrderValidationSummary(data);
      if (!summary.valid) {
        return res.redirect(`${redirectBase}?validation_error=1`);
      }

      await service.updateOrder(orderId, {
        status: "valid",
        updatedBy: res.locals.adminUsername || ""
      });
      return res.redirect(`${redirectBase}?validated=1`);
    },

    async revalidateOrder(req, res) {
      const orderId = Number(req.params.id);
      const data = await loadOrderEditorData(orderId);
      if (!data) return res.status(404).send("OS nao encontrada.");

      const redirectBase = buildOrderEditorRedirect(req, orderId);
      if (!isSystemAdminUser(res)) {
        return res.redirect(`${redirectBase}?revalidate_error=forbidden_admin`);
      }
      if (!isOrderApproved(data.order)) {
        return res.redirect(`${redirectBase}?revalidate_error=invalid_state`);
      }

      await service.updateOrder(orderId, {
        status: "valid",
        updatedBy: res.locals.adminUsername || "revalidate-os"
      });
      await service.updateReport(data.report.id, {
        revision: incrementReportRevision(data.report.revision || "A"),
        issueDate: new Date().toISOString().slice(0, 10)
      });
      return res.redirect(`${redirectBase}?revalidated=1`);
    },

    async addTimesheet(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const activityDate = sanitizeInput(req.body.activity_date);
      const checkInClient = sanitizeInput(req.body.check_in_client);
      const checkOutClient = sanitizeInput(req.body.check_out_client);

      if (checkInClient && checkOutClient) {
        const existing = await repo.listTimesheetByOrder(orderId);
        const overlap = findTimesheetOverlap(existing, activityDate, checkInClient, checkOutClient, null);
        if (overlap) {
          const data = await loadOrderEditorData(orderId);
          if (!data) return res.status(404).send("OS nao encontrada.");
          const orderView = withServiceOrderDisplay(data.order);
          const reportConfig = await getReportConfigSettings();
        return res.render("report-service/order-editor", {
            pageTitle: `Service Report - ${orderView.service_order_display || "-"}`,
            ...data,
            order: orderView,
            reportConfig,
            sectionDefinitions: SECTION_DEFINITIONS,
            quillSectionToolbar: QUILL_SECTION_TOOLBAR,
            quillSectionTitleToolbar: QUILL_SECTION_TITLE_TOOLBAR,
            quillSectionFormats: QUILL_SECTION_FORMATS,
            quillSectionTitleFormats: QUILL_SECTION_TITLE_FORMATS,
          componentCategories: COMPONENT_CATEGORIES,
          signerTypes: SIGNER_TYPES,
          saved: false,
          validationSuccess: false,
          validationError: false,
          osValidation: buildOrderValidationSummary(data),
          timesheetError: `Sobreposicao de horario: conflito com o registro de ${overlap.check_in_client || overlap.check_in_base} - ${overlap.check_out_client || overlap.check_out_base} (${overlap.technician_name || "tecnico"}) no mesmo dia.`,
          csrfToken: req.csrfToken()
        });
      }
      }

      const addInMin = parseTimeToMinutes(checkInClient);
      const addOutMin = parseTimeToMinutes(checkOutClient);
      const addWorkedHours = (addInMin !== null && addOutMin !== null && addOutMin > addInMin)
        ? Math.round((addOutMin - addInMin) / 60 * 100) / 100
        : null;

      await repo.createTimesheetEntry({
        serviceOrderId: orderId,
        activityDate,
        checkInBase: sanitizeInput(req.body.check_in_base),
        checkInClient,
        checkOutClient,
        checkOutBase: sanitizeInput(req.body.check_out_base),
        technicianName: sanitizeInput(req.body.technician_name),
        workedHours: addWorkedHours,
        notes: sanitizeInput(req.body.notes)
      });
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async updateTimesheet(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId, { json: true })) return;
      const entryId = Number(req.params.entryId);
      const activityDate = sanitizeInput(req.body.activity_date);
      const checkInClient = sanitizeInput(req.body.check_in_client);
      const checkOutClient = sanitizeInput(req.body.check_out_client);

      if (checkInClient && checkOutClient) {
        const existing = await repo.listTimesheetByOrder(orderId);
        const overlap = findTimesheetOverlap(existing, activityDate, checkInClient, checkOutClient, entryId);
        if (overlap) {
          return res.status(409).json({
            ok: false,
            error: `Sobreposicao de horario: conflito com ${overlap.check_in_client || overlap.check_in_base} - ${overlap.check_out_client || overlap.check_out_base} (${overlap.technician_name || "tecnico"}) no mesmo dia.`
          });
        }
      }

      const updInMin = parseTimeToMinutes(checkInClient);
      const updOutMin = parseTimeToMinutes(checkOutClient);
      const updWorkedHours = (updInMin !== null && updOutMin !== null && updOutMin > updInMin)
        ? Math.round((updOutMin - updInMin) / 60 * 100) / 100
        : null;

      const updated = await repo.updateTimesheetEntry(entryId, {
        activityDate,
        checkInBase: sanitizeInput(req.body.check_in_base),
        checkInClient,
        checkOutClient,
        checkOutBase: sanitizeInput(req.body.check_out_base),
        technicianName: sanitizeInput(req.body.technician_name),
        workedHours: updWorkedHours,
        notes: sanitizeInput(req.body.notes)
      });
      if (!updated) return res.status(404).json({ ok: false, error: "Registro nao encontrado." });
      return res.status(200).json({ ok: true });
    },

    async deleteTimesheet(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const entryId = Number(req.params.entryId);
      await repo.deleteTimesheetEntry(entryId);
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async addDailyLog(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const dailyLogId = Number(req.body.daily_log_id || 0);
      const payload = {
        serviceOrderId: orderId,
        activityDate: sanitizeInput(req.body.activity_date),
        title: sanitizeInput(req.body.title),
        content: sanitizeReportSectionHtml(req.body.content),
        notes: sanitizeInput(req.body.notes),
        sortOrder: Number(req.body.sort_order || 0)
      };

      if (Number.isInteger(dailyLogId) && dailyLogId > 0) {
        await repo.updateDailyLogByOrderAndId(orderId, dailyLogId, payload);
      } else {
        await repo.createDailyLog(payload);
      }
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async deleteDailyLog(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const dailyLogId = Number(req.params.dailyLogId || 0);
      if (Number.isInteger(dailyLogId) && dailyLogId > 0) {
        await repo.deleteDailyLogByOrderAndId(orderId, dailyLogId);
      }
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async generateConclusionFromLogs(req, res) {
      if (typeof reviseTextWithAi !== "function") {
        return res.status(500).json({ ok: false, message: "Servico de IA indisponivel." });
      }
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId, { json: true })) return;
      const [order, dailyLogs] = await Promise.all([
        repo.getOrderById(orderId),
        repo.listDailyLogsByOrder(orderId)
      ]);
      if (!order) return res.status(404).json({ ok: false, message: "OS nao encontrada." });

      // Filtra logs que nao sao a propria conclusaogeral para evitar recursao
      const sourceLogs = dailyLogs.filter((l) => String(l.notes || "").trim() !== "conclusaogeral");
      if (!sourceLogs.length) {
        return res.status(422).json({ ok: false, message: "Nenhum log diario cadastrado para gerar a conclusao." });
      }

      const combinedText = sourceLogs
        .map((log, i) => {
          const dateLabel = log.activity_date ? String(log.activity_date).slice(0, 10) : `Log ${i + 1}`;
          const titlePart = log.title ? ` - ${log.title}` : "";
          const body = String(log.content || "")
            .replace(/<br\s*\/?>/gi, " ")
            .replace(/<\/p>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/\s+/g, " ")
            .trim();
          return `[${dateLabel}${titlePart}] ${body}`;
        })
        .join("\n\n");

      try {
        const result = await reviseTextWithAi({
          text: combinedText,
          html: "",
          prompt: "Crie um resumo de todas as atividades para servir como uma conclusao tecnica. Escreva em paragrafos claros e objetivos, em portugues. Nao repita datas, sintetize o que foi feito. Separe cada paragrafo com uma linha em branco.",
          preserveFormatting: false
        });

        const plainText = String(result.revisedText || "").trim();
        if (!plainText) {
          return res.status(422).json({ ok: false, message: "A IA nao retornou conteudo para a conclusao." });
        }

        // Constroi HTML compativel com o editor Quill (classes nativas)
        const paragraphs = plainText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        const contentHtml = paragraphs.length
          ? paragraphs.map((p) => `<p class="ql-align-justify">${p}</p>`).join("")
          : "<p><br></p>";

        // Cria ou atualiza o log diario com tag "conclusaogeral"
        const existing = await repo.getDailyLogByTagForOrder(orderId, "conclusaogeral");
        let savedLog;
        if (existing) {
          savedLog = await repo.updateDailyLogByOrderAndId(orderId, existing.id, {
            activityDate: existing.activity_date,
            title: existing.title || "Conclusao Geral",
            content: contentHtml,
            notes: "conclusaogeral",
            sortOrder: existing.sort_order
          });
        } else {
          savedLog = await repo.createDailyLog({
            serviceOrderId: orderId,
            activityDate: new Date().toISOString().slice(0, 10),
            title: "Conclusao Geral",
            content: contentHtml,
            notes: "conclusaogeral",
            sortOrder: 999
          });
        }

        // Limpa o conteudo da secao "conclusion" do relatorio para evitar que
        // o conteudo antigo gerado por IA continue aparecendo no preview
        const report = await service.ensureReportForOrder(orderId, order.title);
        const conclusionSection = await repo.getSectionByKey(report.id, "conclusion");
        if (conclusionSection) {
          await service.upsertReportSection(report.id, "conclusion", {
            sectionTitle: conclusionSection.section_title,
            contentHtml: "<p><br></p>",
            contentText: "",
            isVisible: conclusionSection.is_visible
          });
        }

        return res.status(200).json({ ok: true, dailyLogId: savedLog ? savedLog.id : null });
      } catch (err) {
        return res.status(err.statusCode || 422).json({
          ok: false,
          message: err.message || "Falha ao gerar conclusao com IA."
        });
      }
    },

    async reviseDailyLogText(req, res) {
      if (typeof reviseTextWithAi !== "function") {
        return res.status(500).json({ ok: false, message: "Servico de IA indisponivel." });
      }
      const text = String(req.body && req.body.text ? req.body.text : "");
      const html = String(req.body && req.body.html ? req.body.html : "");
      const preserveFormatting = String(req.body && req.body.preserveFormatting ? req.body.preserveFormatting : "false") === "true";
      const prompt = sanitizeInput(req.body && req.body.prompt ? req.body.prompt : "")
        || "Revise o texto abaixo sem mudar muitas palavras";
      try {
        const result = await reviseTextWithAi({
          text,
          html,
          prompt,
          preserveFormatting
        });
        const revisedHtml = sanitizeReportSectionHtml(result.revisedHtml || "");
        return res.status(200).json({
          ok: true,
          revisedText: result.revisedText || "",
          revisedHtml
        });
      } catch (err) {
        return res.status(err.statusCode || 422).json({
          ok: false,
          message: err.message || "Falha ao revisar texto com IA."
        });
      }
    },

    async reviseSectionText(req, res) {
      if (typeof reviseTextWithAi !== "function") {
        return res.status(500).json({ ok: false, message: "Servico de IA indisponivel." });
      }
      const text = String(req.body && req.body.text ? req.body.text : "");
      const html = String(req.body && req.body.html ? req.body.html : "");
      const preserveFormatting = String(req.body && req.body.preserveFormatting ? req.body.preserveFormatting : "false") === "true";
      const prompt = sanitizeInput(req.body && req.body.prompt ? req.body.prompt : "")
        || "Revise o texto abaixo sem mudar muitas palavras";
      try {
        const result = await reviseTextWithAi({
          text,
          html,
          prompt,
          preserveFormatting
        });
        const revisedHtml = sanitizeReportSectionHtml(result.revisedHtml || "");
        return res.status(200).json({
          ok: true,
          revisedText: result.revisedText || "",
          revisedHtml
        });
      } catch (err) {
        return res.status(err.statusCode || 422).json({
          ok: false,
          message: err.message || "Falha ao revisar texto com IA."
        });
      }
    },

    async saveSection(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const sectionKey = sanitizeInput(req.params.sectionKey).toLowerCase();
      const report = await service.ensureReportForOrder(orderId);
      await service.upsertReportSection(report.id, sectionKey, {
        sectionTitle: sanitizeInput(req.body.section_title),
        sectionTitleDeltaJson: req.body.section_title_delta_json,
        sectionTitleHtml: req.body.section_title_html,
        sectionTitleText: sanitizeInput(req.body.section_title_text),
        contentDeltaJson: req.body.content_delta_json,
        contentHtml: req.body.content_html || req.body.content || "",
        contentText: sanitizeInput(req.body.content_text),
        imageLeftPath: sanitizeInput(req.body.image_left_path),
        imageRightPath: sanitizeInput(req.body.image_right_path),
        isVisible: req.body.is_visible
      });
      const redirectBase = buildOrderEditorRedirect(req, orderId);
      return res.redirect(`${redirectBase}?saved=1`);
    },

    async createSection(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const report = await service.ensureReportForOrder(orderId);

      const beforeSections = await repo.listSections(report.id);

      const sections = await service.createReportSection(report.id, {
        sectionTitle: sanitizeInput(req.body.section_title) || "NOVO CAPITULO",
        sectionTitleText: sanitizeInput(req.body.section_title) || "NOVO CAPITULO",
        contentText: "",
        contentHtml: "<p><br></p>",
        isVisible: true
      });

      const insertAfter = sanitizeInput(req.body.insert_after || "").trim();
      if (insertAfter && insertAfter !== "end") {
        const beforeKeys = new Set(beforeSections.map((s) => s.section_key));
        const newSection = sections.find((s) => !beforeKeys.has(s.section_key));
        if (newSection) {
          const existingKeys = beforeSections.map((s) => s.section_key);
          const newOrderedKeys = [];
          if (insertAfter === "start") {
            newOrderedKeys.push(newSection.section_key);
            newOrderedKeys.push(...existingKeys);
          } else {
            let inserted = false;
            for (const key of existingKeys) {
              newOrderedKeys.push(key);
              if (key === insertAfter) {
                newOrderedKeys.push(newSection.section_key);
                inserted = true;
              }
            }
            if (!inserted) newOrderedKeys.push(newSection.section_key);
          }
          await repo.reorderSections(report.id, newOrderedKeys);
        }
      }

      const createRedirectBase = buildOrderEditorRedirect(req, orderId);
      return res.redirect(`${createRedirectBase}?saved=1`);
    },

    async reorderSections(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const report = await service.ensureReportForOrder(orderId);

      let orderedKeys;
      try {
        orderedKeys = JSON.parse(req.body.section_keys || "[]");
      } catch (_e) {
        orderedKeys = [];
      }

      if (!Array.isArray(orderedKeys) || !orderedKeys.length) {
        return res.status(422).json({ ok: false, message: "Lista de capitulos invalida." });
      }

      const sections = await repo.listSections(report.id);
      const validKeys = new Set(sections.map((s) => s.section_key));
      const cleanKeys = orderedKeys.map((k) => String(k)).filter((k) => validKeys.has(k));

      await repo.reorderSections(report.id, cleanKeys);

      const isJsonReq = String(req.headers.accept || "").includes("application/json");
      if (isJsonReq) return res.json({ ok: true });
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async deleteSection(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const sectionKey = sanitizeInput(req.params.sectionKey).toLowerCase();
      const report = await service.ensureReportForOrder(orderId);
      await service.deleteReportSection(report.id, sectionKey);
      const deleteRedirectBase = buildOrderEditorRedirect(req, orderId);
      return res.redirect(`${deleteRedirectBase}?saved=1`);
    },

    async addComponent(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const report = await service.ensureReportForOrder(orderId);
      await service.createComponent(report.id, {
        category: req.body.category,
        equipmentId: req.body.equipment_id,
        quantity: req.body.quantity,
        description: req.body.description,
        partNumber: req.body.part_number,
        notes: req.body.notes,
        sortOrder: req.body.sort_order
      });
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async deleteComponent(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const componentId = Number(req.params.componentId);
      if (!Number.isInteger(componentId) || componentId <= 0) {
        return res.status(422).send("Componente invalido.");
      }
      const report = await service.ensureReportForOrder(orderId);
      const components = await repo.listComponents(report.id);
      const exists = components.some((item) => Number(item.id) === componentId);
      if (!exists) {
        return res.status(404).send("Componente nao encontrado nesta OS.");
      }
      await repo.deleteComponent(componentId);
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async createSignRequest(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      let data = await loadOrderEditorData(orderId);
      if (!data) return res.status(404).send("OS nao encontrada.");
      const guard = buildElectronicSignatureLinkGuard(data);
      if (!guard.allowed) {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?sign_link_blocked=1`);
      }
      const signerEmail = sanitizeInput(req.body.signer_email) || "";
      if (!isValidEmailAddress(signerEmail)) {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?sign_link_email_error=invalid_signer_email`);
      }
      const report = data.report;
      const token = uuidv4();
      await repo.createSignRequest({
        serviceReportId: report.id,
        token,
        signerName: sanitizeInput(req.body.signer_name) || "",
        signerEmail,
        signerRole: sanitizeInput(req.body.signer_role) || "",
        signerCompany: sanitizeInput(req.body.signer_company) || "",
        notes: sanitizeInput(req.body.notes) || ""
      });
      const emailSettings = await getReportServiceEmailSettings();
      if (!emailSettings.smtp || !emailSettings.smtp.host || !emailSettings.smtp.from) {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?signed_link=1&sign_link_email_error=smtp`);
      }
      try {
        const signLink = buildSignRequestLink(req, token);
        const transporter = nodemailer.createTransport({
          host: emailSettings.smtp.host,
          port: emailSettings.smtp.port,
          secure: emailSettings.smtp.secure,
          auth: emailSettings.smtp.user
            ? { user: emailSettings.smtp.user, pass: emailSettings.smtp.pass }
            : undefined
        });

        const linkTemplate = getTemplateByPurpose(
          emailSettings.emailTemplates,
          emailSettings.defaultTemplateId,
          "envio_assinatura"
        );
        const vars = buildSignedReportTemplateVariables(data.order, report, signLink, {
          signatario: sanitizeInput(req.body.signer_name) || ""
        });
        const orderDisplay = data.order.service_order_display || data.order.service_order_code || `OS-${orderId}`;
        const subject = sanitizeSubjectHeaderValue(
          linkTemplate && linkTemplate.subject
            ? renderEmailPlaceholder(linkTemplate.subject, vars)
            : `Solicitacao de assinatura - ${report.report_number || orderDisplay}`
        );
        let htmlBody;
        if (linkTemplate && linkTemplate.html) {
          htmlBody = `<!doctype html><html><body>${renderEmailPlaceholder(linkTemplate.html, vars)}</body></html>`;
        } else {
          htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;"><p style="margin:0 0 12px 0;">Foi solicitada sua assinatura eletrônica para o relatório técnico.</p><p style="margin:0 0 8px 0;"><strong>OS:</strong> ${orderDisplay}</p><p style="margin:0 0 8px 0;"><strong>Relatório:</strong> ${report.report_number || "-"}</p><p style="margin:16px 0;"><a href="${escapeHtml(signLink)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#14532d;color:#fff;text-decoration:none;font-weight:600;">Abrir para assinar</a></p><p style="margin:12px 0 0 0;color:#6b7280;font-size:12px;">E-mail enviado pelo modulo Service Report.</p></body></html>`;
        }
        await transporter.sendMail({
          from: emailSettings.smtp.from,
          to: signerEmail,
          subject,
          html: htmlBody
        });
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?signed_link=1&sign_link_email_sent=1`);
      } catch (_err) {
        // eslint-disable-next-line no-console
        console.error("[report-service] Link de assinatura criado, mas houve falha ao enviar e-mail ao signatario.", _err);
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?signed_link=1&sign_link_email_error=send_failed`);
      }
    },

    async translateReport(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const targetLanguage = normalizeReportLanguage(req.body.target_language, "");
      if (!targetLanguage) {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?translate_error=invalid_language`);
      }
      try {
        const result = await translatePersistedReportContent(orderId, targetLanguage);
        if (!result.changed) {
          return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?translated=1&translated_to=${encodeURIComponent(result.targetLanguage)}&saved=1`);
        }
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?translated=1&translated_to=${encodeURIComponent(result.targetLanguage)}&saved=1`);
      } catch (err) {
        const errorCode = err && (err.statusCode === 500 || err.statusCode === 503) ? "ai_unavailable" : "failed";
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?translate_error=${errorCode}`);
      }
    },

    async startTranslateReportJob(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId, { json: true })) return;
      const targetLanguage = normalizeReportLanguage(req.body && req.body.target_language, "");
      if (!targetLanguage) {
        return res.status(422).json({ ok: false, message: "Idioma de tradução inválido." });
      }
      const job = createTranslationJob({ orderId, targetLanguage });
      return res.status(202).json({
        ok: true,
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        targetLanguage: job.targetLanguage
      });
    },

    async getTranslateReportJob(req, res) {
      const orderId = Number(req.params.id);
      const jobId = String(req.params.jobId || "");
      const job = translationJobs.get(jobId);
      if (!job || Number(job.orderId) !== orderId) {
        return res.status(404).json({ ok: false, message: "Job de tradução não encontrado." });
      }
      return res.status(200).json({
        ok: true,
        jobId: job.id,
        orderId: job.orderId,
        targetLanguage: job.targetLanguage,
        status: job.status,
        progress: Number(job.progress || 0),
        message: job.message || "",
        error: job.error || "",
        updatedAt: job.updatedAt || "",
        finishedAt: job.finishedAt || ""
      });
    },

    async updateSignRequest(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const requestId = Number(req.params.requestId);
      const report = await service.ensureReportForOrder(orderId);
      const signRequests = await repo.listSignRequestsByReportId(report.id);
      const target = signRequests.find((item) => Number(item.id) === requestId);
      if (!target) {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?saved=1`);
      }
      if (String(target.status || "").toLowerCase() !== "pending") {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?sign_request_edit_blocked=1`);
      }

      await repo.updateSignRequest(requestId, {
        signerName: sanitizeInput(req.body.signer_name) || "",
        signerRole: sanitizeInput(req.body.signer_role) || "",
        signerCompany: sanitizeInput(req.body.signer_company) || "",
        signerEmail: sanitizeInput(req.body.signer_email) || "",
        notes: sanitizeInput(req.body.notes) || ""
      });
      return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?sign_request_updated=1`);
    },

    async cancelSignRequest(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const requestId = Number(req.params.requestId);
      await repo.updateSignRequest(requestId, { status: "cancelled" });
      return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?saved=1`);
    },

    async deleteSignRequest(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const requestId = Number(req.params.requestId);
      const report = await service.ensureReportForOrder(orderId);
      await repo.deleteSignRequest(requestId, report.id);
      return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?saved=1`);
    },

    async sendSignedReportByEmail(req, res) {
      const orderId = Number(req.params.id);
      const data = await loadOrderEditorData(orderId);
      if (!data) return res.status(404).send("OS nao encontrada.");
      let signRequests = [];
      try {
        signRequests = await repo.listSignRequestsByReportId(data.report.id);
      } catch (_err) {
        signRequests = [];
      }
      if (!hasSignedApproval(signRequests, data.signatures)) {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?email_error=not_signed`);
      }

      const to = parseEmailList(req.body.to);
      const cc = parseEmailList(req.body.cc);
      if (!to.length || to.some((item) => !isValidEmailAddress(item))) {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?email_error=invalid_to`);
      }
      if (cc.some((item) => !isValidEmailAddress(item))) {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?email_error=invalid_cc`);
      }

      const emailSettings = await getReportServiceEmailSettings();
      if (!emailSettings.smtp || !emailSettings.smtp.host || !emailSettings.smtp.from) {
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?email_error=smtp`);
      }

      try {
        const signedRequest = (Array.isArray(signRequests) ? signRequests : [])
          .find((item) => String(item.status || "").toLowerCase() === "signed" && String(item.token || "").trim());
        if (!signedRequest) {
          return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?email_error=token_not_found`);
        }
        const signedLink = buildSignedReportLink(req, signedRequest.token);

        const transporter = nodemailer.createTransport({
          host: emailSettings.smtp.host,
          port: emailSettings.smtp.port,
          secure: emailSettings.smtp.secure,
          auth: emailSettings.smtp.user
            ? { user: emailSettings.smtp.user, pass: emailSettings.smtp.pass }
            : undefined
        });

        const reportNumber = String(data.report.report_number || "").trim();
        const orderDisplay = data.order.service_order_display || data.order.service_order_code || `OS-${orderId}`;

        const signedTemplate = getTemplateByPurpose(
          emailSettings.emailTemplates,
          emailSettings.defaultTemplateId,
          "relatorio_assinado"
        );
        const signedVars = buildSignedReportTemplateVariables(data.order, data.report, signedLink);
        const subject = sanitizeSubjectHeaderValue(
          signedTemplate && signedTemplate.subject
            ? renderEmailPlaceholder(signedTemplate.subject, signedVars)
            : `Relatorio assinado ${reportNumber || orderDisplay}`
        );
        const customMessage = sanitizeInput(req.body.message || "");
        let htmlBody;
        if (signedTemplate && signedTemplate.html) {
          htmlBody = `<!doctype html><html><body>${renderEmailPlaceholder(signedTemplate.html, signedVars)}</body></html>`;
        } else {
          const bodyIntro = customMessage
            ? `<p style="margin:0 0 12px 0;">${customMessage}</p>`
            : "<p style=\"margin:0 0 12px 0;\">Seu relatorio assinado esta disponivel no link abaixo para visualizacao e impressao.</p>";
          htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;">${bodyIntro}<p style="margin:0 0 8px 0;"><strong>OS:</strong> ${orderDisplay}</p><p style="margin:0 0 8px 0;"><strong>Relatorio:</strong> ${reportNumber || "-"}</p><p style="margin:0 0 8px 0;"><strong>Cliente:</strong> ${data.order.customer_name || "-"}</p><p style="margin:16px 0;"><a href="${escapeHtml(signedLink)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#14532d;color:#fff;text-decoration:none;font-weight:600;">Abrir relatorio assinado</a></p><p style="margin:12px 0 0 0;color:#6b7280;font-size:12px;">E-mail enviado pelo modulo Service Report.</p></body></html>`;
        }

        await transporter.sendMail({
          from: emailSettings.smtp.from,
          to,
          cc: cc.length ? cc : undefined,
          subject,
          html: htmlBody
        });

        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?email_sent=1`);
      } catch (_err) {
        // eslint-disable-next-line no-console
        console.error("[report-service] Falha ao enviar e-mail com relatorio assinado (admin).", _err);
        return res.redirect(`/admin/report-service/orders/${orderId}/report-editor?email_error=send_failed`);
      }
    },

    async sendOsCreatedEmail(req, res) {
      const orderId = Number(req.params.id);
      const data = await loadOrderEditorData(orderId);
      if (!data) return res.status(404).send("OS nao encontrada.");

      const technicians = Array.isArray(data.technicians) ? data.technicians : [];
      const toFromTechs = technicians
        .map((t) => String(t.email || "").trim())
        .filter((e) => isValidEmailAddress(e));

      const extraTo = parseEmailList(req.body.to);
      const cc = parseEmailList(req.body.cc);
      const to = Array.from(new Set([...toFromTechs, ...extraTo])).filter((e) => isValidEmailAddress(e));

      if (!to.length) {
        return res.redirect(`/admin/report-service/orders/${orderId}?os_email_error=no_recipients`);
      }
      if (cc.some((item) => !isValidEmailAddress(item))) {
        return res.redirect(`/admin/report-service/orders/${orderId}?os_email_error=invalid_cc`);
      }

      const emailSettings = await getReportServiceEmailSettings();
      if (!emailSettings.smtp || !emailSettings.smtp.host || !emailSettings.smtp.from) {
        return res.redirect(`/admin/report-service/orders/${orderId}?os_email_error=smtp`);
      }

      try {
        const transporter = nodemailer.createTransport({
          host: emailSettings.smtp.host,
          port: emailSettings.smtp.port,
          secure: emailSettings.smtp.secure,
          auth: emailSettings.smtp.user
            ? { user: emailSettings.smtp.user, pass: emailSettings.smtp.pass }
            : undefined
        });

        const osVars = buildOsTemplateVariables(data.order, technicians);
        const osTemplate = getTemplateByPurpose(
          emailSettings.emailTemplates,
          emailSettings.defaultTemplateId,
          "nova_os"
        );
        const orderDisplay = data.order.service_order_display || data.order.service_order_code || `OS-${orderId}`;
        const subject = sanitizeSubjectHeaderValue(
          osTemplate && osTemplate.subject
            ? renderEmailPlaceholder(osTemplate.subject, osVars)
            : `Nova OS: ${orderDisplay}`
        );
        let htmlBody;
        if (osTemplate && osTemplate.html) {
          htmlBody = `<!doctype html><html><body>${renderEmailPlaceholder(osTemplate.html, osVars)}</body></html>`;
        } else {
          htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;"><p style="margin:0 0 12px 0;">Uma nova Ordem de Servico foi criada e voce foi designado como tecnico responsavel.</p><p style="margin:0 0 8px 0;"><strong>OS:</strong> ${orderDisplay}</p><p style="margin:0 0 8px 0;"><strong>Titulo:</strong> ${data.order.title || "-"}</p><p style="margin:0 0 8px 0;"><strong>Cliente:</strong> ${data.order.customer_name || "-"}</p><p style="margin:0 0 8px 0;"><strong>Local:</strong> ${data.order.site_name || "-"}</p><p style="margin:0 0 8px 0;"><strong>Data de abertura:</strong> ${osVars.data_abertura || "-"}</p><p style="margin:12px 0 0 0;color:#6b7280;font-size:12px;">E-mail enviado pelo modulo Service Report.</p></body></html>`;
        }

        await transporter.sendMail({
          from: emailSettings.smtp.from,
          to,
          cc: cc.length ? cc : undefined,
          subject,
          html: htmlBody
        });

        return res.redirect(`/admin/report-service/orders/${orderId}?os_email_sent=1`);
      } catch (_err) {
        return res.redirect(`/admin/report-service/orders/${orderId}?os_email_error=send_failed`);
      }
    },

    async addSignature(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const signerType = sanitizeInput(req.body.signer_type).toLowerCase();
      if (signerType === "vextrom_technician") {
        return res.redirect(`/admin/report-service/orders/${orderId}/sign-report`);
      }
      const report = await service.ensureReportForOrder(orderId);
      await service.createSignature(report.id, {
        signerType,
        signerName: req.body.signer_name,
        signerRole: req.body.signer_role,
        signerCompany: req.body.signer_company,
        signatureData: req.body.signature_data,
        updatedBy: res.locals.adminUsername || "manual-signature"
      });
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async deleteSignature(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const signatureId = Number(req.params.signatureId);
      const referer = String(req.headers.referer || "");
      const fromReportEditor = referer.includes("/report-editor");
      const fromSignReport = referer.includes("/sign-report");
      const report = await service.ensureReportForOrder(orderId);
      await repo.deleteSignature(signatureId, report.id);
      const redirectBase = fromSignReport
        ? `/admin/report-service/orders/${orderId}/sign-report`
        : fromReportEditor
        ? `/admin/report-service/orders/${orderId}/report-editor`
        : `/admin/report-service/orders/${orderId}`;
      return res.redirect(`${redirectBase}?saved=1`);
    },

    // ---- Cadastro global de tecnicos e instrumentos ----

    async listAssetsGlobal(req, res) {
      const [technicians, instruments] = await Promise.all([
        repo.listGlobalTechnicians(),
        repo.listGlobalInstruments()
      ]);
      return res.render("report-service/assets-global", {
        pageTitle: "Service Report - Equipe e Instrumentos",
        technicians,
        instruments,
        saved: req.query.saved === "1",
        csrfToken: req.csrfToken()
      });
    },

    async createGlobalTechnician(req, res) {
      if (!sanitizeInput(req.body.name)) return res.status(422).send("Nome obrigatorio.");
      await repo.createGlobalTechnician({
        name: sanitizeInput(req.body.name),
        role: sanitizeInput(req.body.role),
        company: sanitizeInput(req.body.company),
        email: sanitizeInput(req.body.email),
        phone: sanitizeInput(req.body.phone),
        isLead: req.body.is_lead === "on" || req.body.is_lead === "true"
      });
      return res.redirect("/admin/report-service/assets?saved=1");
    },

    async updateGlobalTechnician(req, res) {
      const techId = Number(req.params.techId);
      await repo.updateGlobalTechnician(techId, {
        name: sanitizeInput(req.body.name),
        role: sanitizeInput(req.body.role),
        company: sanitizeInput(req.body.company),
        email: sanitizeInput(req.body.email),
        phone: sanitizeInput(req.body.phone),
        isLead: req.body.is_lead === "on" || req.body.is_lead === "true"
      });
      return res.redirect("/admin/report-service/assets?saved=1");
    },

    async deleteGlobalTechnician(req, res) {
      await repo.deleteGlobalTechnician(Number(req.params.techId));
      return res.redirect("/admin/report-service/assets?saved=1");
    },

    async createGlobalInstrument(req, res) {
      if (!sanitizeInput(req.body.name)) return res.status(422).send("Nome obrigatorio.");
      await repo.createGlobalInstrument({
        name: sanitizeInput(req.body.name),
        model: sanitizeInput(req.body.model),
        serialNumber: sanitizeInput(req.body.serial_number),
        calibrationDueDate: sanitizeInput(req.body.calibration_due_date) || null,
        notes: sanitizeInput(req.body.notes)
      });
      return res.redirect("/admin/report-service/assets?saved=1");
    },

    async updateGlobalInstrument(req, res) {
      const instrId = Number(req.params.instrId);
      await repo.updateGlobalInstrument(instrId, {
        name: sanitizeInput(req.body.name),
        model: sanitizeInput(req.body.model),
        serialNumber: sanitizeInput(req.body.serial_number),
        calibrationDueDate: sanitizeInput(req.body.calibration_due_date) || null,
        notes: sanitizeInput(req.body.notes)
      });
      return res.redirect("/admin/report-service/assets?saved=1");
    },

    async deleteGlobalInstrument(req, res) {
      await repo.deleteGlobalInstrument(Number(req.params.instrId));
      return res.redirect("/admin/report-service/assets?saved=1");
    },

    // ---- Vinculo de tecnicos/instrumentos com OS ----

    async assetsEditor(req, res) {
      const orderId = Number(req.params.id);
      const order = await repo.getOrderById(orderId);
      if (!order) return res.status(404).send("OS nao encontrada.");
      const [allTechnicians, allInstruments, linkedTechs, linkedInstrs] = await Promise.all([
        repo.listGlobalTechnicians(),
        repo.listGlobalInstruments(),
        repo.listTechniciansByOrder(orderId),
        repo.listInstrumentsByOrder(orderId)
      ]);
      const orderView = withServiceOrderDisplay(order);
      const linkedTechIds = new Set(linkedTechs.map((t) => t.id));
      const linkedInstrIds = new Set(linkedInstrs.map((i) => i.id));
      return res.render("report-service/assets-editor", {
        pageTitle: `Equipe e Instrumentos - ${orderView.service_order_display || "-"}`,
        order: orderView,
        allTechnicians,
        allInstruments,
        linkedTechs,
        linkedInstrs,
        linkedTechIds: Array.from(linkedTechIds),
        linkedInstrIds: Array.from(linkedInstrIds),
        saved: req.query.saved === "1",
        csrfToken: req.csrfToken()
      });
    },

    async linkTechnicianToOrder(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const techId = Number(req.body.technician_id);
      if (techId > 0) await repo.linkTechnicianToOrder(orderId, techId);
      return res.redirect(`/admin/report-service/orders/${orderId}/assets?saved=1`);
    },

    async unlinkTechnicianFromOrder(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const techId = Number(req.params.techId);
      await repo.unlinkTechnicianFromOrder(orderId, techId);
      return res.redirect(`/admin/report-service/orders/${orderId}/assets?saved=1`);
    },

    async linkTechnicianToOrderEditor(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const techId = Number(req.body.technician_id);
      if (techId > 0) await repo.linkTechnicianToOrder(orderId, techId);
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async unlinkTechnicianFromOrderEditor(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const techId = Number(req.params.techId);
      await repo.unlinkTechnicianFromOrder(orderId, techId);
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async linkInstrumentToOrder(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const instrId = Number(req.body.instrument_id);
      if (instrId > 0) await repo.linkInstrumentToOrder(orderId, instrId);
      return res.redirect(`/admin/report-service/orders/${orderId}/assets?saved=1`);
    },

    async unlinkInstrumentFromOrder(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const instrId = Number(req.params.instrId);
      await repo.unlinkInstrumentFromOrder(orderId, instrId);
      return res.redirect(`/admin/report-service/orders/${orderId}/assets?saved=1`);
    },

    async addTechnician(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const name = sanitizeInput(req.body.name);
      if (!name) return res.status(422).send("Nome obrigatorio.");
      const created = await repo.createGlobalTechnician({
        name,
        role: sanitizeInput(req.body.role),
        company: sanitizeInput(req.body.company),
        email: sanitizeInput(req.body.email),
        phone: sanitizeInput(req.body.phone),
        isLead: req.body.is_lead === "on" || req.body.is_lead === "true"
      });
      await repo.linkTechnicianToOrder(orderId, created.id);
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async addInstrument(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const report = await service.ensureReportForOrder(orderId);
      await repo.createInstrument({
        serviceReportId: report.id,
        name: sanitizeInput(req.body.name),
        model: sanitizeInput(req.body.model),
        serialNumber: sanitizeInput(req.body.serial_number),
        calibrationDueDate: sanitizeInput(req.body.calibration_due_date) || null,
        notes: sanitizeInput(req.body.notes)
      });
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async importImage(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId, { json: true })) return;
      const report = await service.ensureReportForOrder(orderId);
      let fileNameRaw = "imagem";
      try {
        fileNameRaw = decodeURIComponent(String(req.headers["x-file-name"] || "imagem"));
      } catch (_err) {
        fileNameRaw = String(req.headers["x-file-name"] || "imagem");
      }
      fileNameRaw = sanitizeInput(fileNameRaw);
      const fileNameBase = path.basename(fileNameRaw).replace(/[^a-zA-Z0-9._-]/g, "") || "imagem";
      const extFromName = path.extname(fileNameBase).toLowerCase();
      const mime = String(req.headers["content-type"] || "").toLowerCase();
      const extFromMime = mime.includes("png")
        ? ".png"
        : mime.includes("jpeg") || mime.includes("jpg")
          ? ".jpg"
          : mime.includes("webp")
            ? ".webp"
            : mime.includes("gif")
              ? ".gif"
              : "";
      const ext = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extFromName) ? extFromName : extFromMime;
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      if (!ext || !buffer.length) {
        return res.status(400).json({ ok: false, error: "Arquivo de imagem invalido." });
      }
      const optimizedBuffer = await optimizeTagImageUploadBuffer(buffer, ext);

      const targetDir = path.join(process.cwd(), "docs", "report", "img");
      await fs.promises.mkdir(targetDir, { recursive: true });
      const fileSafeBase = path.basename(fileNameBase, extFromName || path.extname(fileNameBase)).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "imagem";
      const unique = crypto.randomBytes(6).toString("hex");
      const finalName = `${Date.now()}-${fileSafeBase}-${unique}${ext === ".jpeg" ? ".jpg" : ext}`;
      const absolutePath = path.join(targetDir, finalName);
      await fs.promises.writeFile(absolutePath, optimizedBuffer);

      let captionRaw = "";
      try {
        captionRaw = decodeURIComponent(String(req.headers["x-caption"] || ""));
      } catch (_err) {
        captionRaw = String(req.headers["x-caption"] || "");
      }

      const created = await repo.createImage({
        serviceReportId: report.id,
        sectionKey: "__tag__",
        filePath: finalName,
        caption: sanitizeInput(captionRaw),
        sortOrder: 0
      });

      return res.status(201).json({
        ok: true,
        data: {
          id: created.ref_id,
          filePath: finalName,
          sizeBytes: optimizedBuffer.length
        }
      });
    },

    async updateImageLabel(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const imageId = Number(req.params.imageId);
      if (!Number.isInteger(imageId) || imageId <= 0) {
        return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
      }
      const report = await service.ensureReportForOrder(orderId);
      await repo.updateImageCaptionByRefId(report.id, imageId, sanitizeInput(req.body.caption || ""));
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async deleteImage(req, res) {
      const orderId = Number(req.params.id);
      if (!await ensureOrderEditable(req, res, orderId)) return;
      const imageId = Number(req.params.imageId);
      const report = await service.ensureReportForOrder(orderId);
      await repo.deleteImageByRefId(report.id, imageId);
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async previewPage(req, res) {
      const orderId = Number(req.params.id);
      const report = await service.ensureReportForOrder(orderId);
      const payload = await service.buildReportAggregate(report.id);
      if (!payload) return res.status(404).send("Relatorio nao encontrado.");
      const { reportConfig, templateKey } = await resolveRenderConfig("", null);
      return res.render("report-service/preview", {
        pageTitle: `Preview - ${payload.report.report_number}`,
        ...buildPreviewModel(payload, { reportConfig, templateKey }),
        csrfToken: req.csrfToken()
      });
    },

    async previewHtmlPage(req, res) {
      const orderId = Number(req.params.id);
      const { reportConfig, templateKey } = await resolveRenderConfig("", null);
      return res.redirect(buildTemplatePreviewRoute(orderId, templateKey));
    },

    async previewHtmlByTemplatePage(req, res) {
      const orderId = Number(req.params.id);
      const report = await service.ensureReportForOrder(orderId);
      const payload = await service.buildReportAggregate(report.id);
      if (!payload) return res.status(404).send("Relatorio nao encontrado.");

      const requestedTemplateKey = sanitizeInput(req.params.templateKey);
      const { reportConfig, templateKey } = await resolveRenderConfig(requestedTemplateKey, null);
      const model = buildPreviewModel(payload, { reportConfig, templateKey });
      const bodyHtml = await renderReportPreviewHtml(payload, { reportConfig, templateKey });
      const cacheVersion = encodeURIComponent(String(model.generatedAt || Date.now()));
      const availableTemplates = getReportTemplateOptions();
      const currentTemplateName = (availableTemplates.find((item) => item.key === templateKey) || {}).name || templateKey;
      const pageTitle = `Preview HTML (${currentTemplateName}) - ${payload.report && payload.report.report_number ? payload.report.report_number : "Service Report"}`;

      const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=960, initial-scale=1.0" />
  <title>${String(pageTitle).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>
  <link href="/public/css/report-preview.css" rel="stylesheet" />
  <link href="/public/css/report-print.css" rel="stylesheet" />
  <style>
    .rpt-action-bar {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: stretch;
    }
    .report-print-btn, .report-pdf-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      white-space: nowrap;
    }
    .report-print-btn { background: #4f7d33; color: #fff; }
    .report-print-btn:hover { background: #3d6228; }
    .report-pdf-btn { background: #1a56a0; color: #fff; }
    .report-pdf-btn:hover:not(:disabled) { background: #134080; }
    .report-pdf-btn:disabled { background: #6a96cc; cursor: wait; }
    #rpt-print-modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0,0,0,0.45);
      align-items: center;
      justify-content: center;
    }
    #rpt-print-modal .rpt-modal-box {
      background: #fff;
      border-radius: 12px;
      padding: 32px 36px;
      max-width: 440px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.22);
      font-family: sans-serif;
    }
    #rpt-print-modal h2 {
      margin: 0 0 8px;
      font-size: 1.1rem;
      color: #1f1f1f;
    }
    #rpt-print-modal p.rpt-modal-sub {
      margin: 0 0 20px;
      font-size: 0.82rem;
      color: #666;
    }
    #rpt-print-modal ul {
      margin: 0 0 24px;
      padding: 0 0 0 18px;
      font-size: 0.9rem;
      color: #2a2a2a;
      line-height: 1.9;
    }
    #rpt-print-modal ul li strong { color: #1f1f1f; }
    #rpt-print-modal .rpt-modal-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
    #rpt-print-modal .rpt-modal-cancel {
      padding: 9px 18px;
      border: 1px solid #ccc;
      background: #fff;
      border-radius: 7px;
      cursor: pointer;
      font-size: 0.88rem;
      color: #555;
    }
    #rpt-print-modal .rpt-modal-confirm {
      padding: 9px 20px;
      background: #4f7d33;
      color: #fff;
      border: none;
      border-radius: 7px;
      cursor: pointer;
      font-size: 0.88rem;
      font-weight: 600;
    }
    #rpt-print-modal .rpt-modal-confirm:hover { background: #3d6228; }
    @media print {
      .rpt-action-bar { display: none !important; }
      #rpt-print-modal { display: none !important; }
    }
  </style>
</head>
<body>
<div class="rpt-action-bar">
  <button class="report-print-btn" onclick="document.getElementById('rpt-print-modal').style.display='flex'">&#128424; Imprimir</button>
</div>
<div id="rpt-print-modal" role="dialog" aria-modal="true" aria-labelledby="rpt-modal-title">
  <div class="rpt-modal-box">
    <h2 id="rpt-modal-title">Configurar impressao</h2>
    <p class="rpt-modal-sub">Para melhor resultado, use as configuracoes abaixo na janela de impressao:</p>
    <ul>
      <li><strong>Impressora:</strong> Salvar como PDF</li>
      <li><strong>Papel:</strong> A4</li>
      <li><strong>Margens:</strong> Padrao</li>
      <li><strong>Escala:</strong> 100%</li>
      <li><strong>Graficos de segundo plano:</strong> Ativado</li>
    </ul>
    <div class="rpt-modal-actions">
      <button class="rpt-modal-cancel" onclick="document.getElementById('rpt-print-modal').style.display='none'">Cancelar</button>
      <button class="rpt-modal-confirm" onclick="document.getElementById('rpt-print-modal').style.display='none'; window.print()">&#128424; Imprimir</button>
    </div>
  </div>
</div>
${bodyHtml}
<script src="/public/js/report-pagination.js?v=${cacheVersion}"></script>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(fullHtml);
    },

    async pdfPreview(req, res) {
      const orderId = Number(req.params.id);
      const report = await service.ensureReportForOrder(orderId);
      const payload = await service.buildReportAggregate(report.id);
      if (!payload) return res.status(404).send("Relatorio nao encontrado.");
      const requestedTemplateKey = sanitizeInput(req.query.template_key || req.body?.template_key);
      const { templateKey } = await resolveRenderConfig(requestedTemplateKey, null);
      const buffer = await buildPdfFromPreviewRoute(req, orderId, templateKey, payload);
      res.setHeader("Content-Type", "application/pdf");
      return res.send(buffer);
    },

    async generatePdf(req, res) {
      const orderId = Number(req.params.id);
      const report = await service.ensureReportForOrder(orderId);
      const payload = await service.buildReportAggregate(report.id);
      if (!payload) return res.status(404).send("Relatorio nao encontrado.");
      const outputPath = service.resolveReportPdfPath(report.id);
      const requestedTemplateKey = sanitizeInput(req.body.template_key || req.query.template_key);
      const { reportConfig, templateKey } = await resolveRenderConfig(requestedTemplateKey, null);
      const htmlSource = await renderReportPreviewHtml(payload, { reportConfig, templateKey });
      await fs.promises.writeFile(service.resolveReportHtmlPath(report.id), htmlSource, "utf8");
      const pdfBuffer = await buildPdfFromPreviewRoute(req, orderId, templateKey, payload);
      await fs.promises.writeFile(outputPath, pdfBuffer);
      await service.updateReport(report.id, {
        pdfPath: outputPath,
        status: "issued",
        issueDate: new Date().toISOString().slice(0, 10)
      });
      return res.redirect(`${buildOrderEditorRedirect(req, orderId)}?saved=1`);
    },

    async reportEditor(req, res) {
      const reportId = Number(req.params.id);
      const report = await repo.getReportById(reportId);
      if (!report) return res.status(404).send("Relatorio nao encontrado.");
      return res.redirect(`/admin/report-service/orders/${report.service_order_id}`);
    },

    async reportPreview(req, res) {
      const reportId = Number(req.params.id);
      const report = await repo.getReportById(reportId);
      if (!report) return res.status(404).send("Relatorio nao encontrado.");
      return res.redirect(`/admin/report-service/orders/${report.service_order_id}/preview`);
    },

    async reportGeneratePdf(req, res) {
      const reportId = Number(req.params.id);
      const report = await repo.getReportById(reportId);
      if (!report) return res.status(404).send("Relatorio nao encontrado.");
      return res.redirect(307, `/admin/report-service/orders/${report.service_order_id}/generate-pdf`);
    }
  };
}

module.exports = {
  createReportWebController
};
