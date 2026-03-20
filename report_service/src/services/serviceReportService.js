const path = require("path");
const fs = require("fs");
const repo = require("../repositories/serviceReportRepository");
const { normalizeSectionContent } = require("./quillContentService");
const {
  ORDER_STATUSES,
  REPORT_STATUSES,
  SECTION_DEFINITIONS,
  COMPONENT_CATEGORIES,
  SIGNER_TYPES
} = require("../constants");

function ensureStatus(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function buildOrderCode(customerName, year, sequence) {
  const pattern = String(process.env.SERVICE_REPORT_ORDER_CODE_PATTERN || "CLIENT_YEAR_SEQ").toUpperCase();
  const seq = String(sequence).padStart(3, "0");
  const yearShort = String(year).slice(-2);
  const customerCode = String(customerName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 4) || "CLNT";

  if (pattern === "SHORT_YEAR_SEQ") return `${yearShort}-${seq}`;
  if (pattern === "YEAR_SEQ") return `${year}-${seq}`;
  return `OS-${customerCode}-${year}-${seq}`;
}

function sanitizeText(value) {
  return String(value || "").trim();
}

async function createOrder(input = {}) {
  const customerId = repo.toInt(input.customerId);
  if (!customerId) {
    const err = new Error("OS requer cliente.");
    err.statusCode = 422;
    throw err;
  }
  const customer = await repo.getCustomerById(customerId);
  if (!customer) {
    const err = new Error("Cliente nao encontrado.");
    err.statusCode = 404;
    throw err;
  }
  const year = Number(input.year || new Date().getFullYear());
  const sequence = await repo.getOrderCodeSequence(year);
  const serviceOrderCode = buildOrderCode(customer.name, year, sequence);
  const created = await repo.createOrder({
    serviceOrderCode,
    year,
    customerId,
    siteId: repo.toInt(input.siteId),
    title: sanitizeText(input.title) || `Ordem ${serviceOrderCode}`,
    description: sanitizeText(input.description),
    status: ensureStatus(input.status, ORDER_STATUSES, "draft"),
    openingDate: input.openingDate || null,
    closingDate: input.closingDate || null,
    createdBy: sanitizeText(input.createdBy),
    updatedBy: sanitizeText(input.updatedBy)
  });

  await ensureReportForOrder(created.id, created.title);
  return repo.getOrderById(created.id);
}

async function updateOrder(id, input = {}) {
  const existing = await repo.getOrderById(id);
  if (!existing) {
    const err = new Error("OS nao encontrada.");
    err.statusCode = 404;
    throw err;
  }
  const customerId = repo.toInt(input.customerId || existing.customer_id);
  if (!customerId) {
    const err = new Error("OS requer cliente.");
    err.statusCode = 422;
    throw err;
  }
  const updated = await repo.updateOrder(id, {
    customerId,
    siteId: repo.toInt(input.siteId || existing.site_id),
    title: sanitizeText(input.title || existing.title),
    description: sanitizeText(input.description || existing.description),
    status: ensureStatus(input.status || existing.status, ORDER_STATUSES, "draft"),
    openingDate: input.openingDate || existing.opening_date || null,
    closingDate: input.closingDate || existing.closing_date || null,
    updatedBy: sanitizeText(input.updatedBy)
  });
  return updated;
}

async function createCustomer(input = {}) {
  const name = sanitizeText(input.name);
  if (!name) {
    const err = new Error("Nome do cliente e obrigatorio.");
    err.statusCode = 422;
    throw err;
  }
  return repo.createCustomer({
    name,
    customerType: sanitizeText(input.customerType || "others").toLowerCase(),
    notes: sanitizeText(input.notes)
  });
}

async function createSite(input = {}) {
  const customerId = repo.toInt(input.customerId);
  if (!customerId) {
    const err = new Error("Site requer cliente.");
    err.statusCode = 422;
    throw err;
  }
  const siteName = sanitizeText(input.siteName);
  if (!siteName) {
    const err = new Error("Nome do site e obrigatorio.");
    err.statusCode = 422;
    throw err;
  }
  return repo.createSite({
    customerId,
    siteName,
    siteCode: sanitizeText(input.siteCode),
    location: sanitizeText(input.location),
    notes: sanitizeText(input.notes)
  });
}

async function createEquipment(input = {}) {
  const type = sanitizeText(input.type);
  if (!type) {
    const err = new Error("Tipo de equipamento e obrigatorio.");
    err.statusCode = 422;
    throw err;
  }
  return repo.createEquipment({
    customerId: repo.toInt(input.customerId),
    siteId: repo.toInt(input.siteId),
    type,
    yearOfManufacture: sanitizeText(input.yearOfManufacture),
    serialNumber: sanitizeText(input.serialNumber),
    ratedAcInputVoltage: sanitizeText(input.ratedAcInputVoltage),
    inputFrequency: sanitizeText(input.inputFrequency),
    ratedDcVoltage: sanitizeText(input.ratedDcVoltage),
    ratedAcOutputVoltage: sanitizeText(input.ratedAcOutputVoltage),
    outputFrequency: sanitizeText(input.outputFrequency),
    degreeOfProtection: sanitizeText(input.degreeOfProtection),
    mainLabel: sanitizeText(input.mainLabel),
    dtNumber: sanitizeText(input.dtNumber),
    tagNumber: sanitizeText(input.tagNumber),
    manufacturer: sanitizeText(input.manufacturer),
    modelFamily: sanitizeText(input.modelFamily),
    notes: sanitizeText(input.notes)
  });
}

async function updateEquipment(id, input = {}) {
  const existing = await repo.getEquipmentById(id);
  if (!existing) {
    const err = new Error("Equipamento nao encontrado.");
    err.statusCode = 404;
    throw err;
  }
  return repo.updateEquipment(id, {
    customerId: repo.toInt(input.customerId || existing.customer_id),
    siteId: repo.toInt(input.siteId || existing.site_id),
    type: sanitizeText(input.type || existing.type),
    yearOfManufacture: sanitizeText(input.yearOfManufacture || existing.year_of_manufacture),
    serialNumber: sanitizeText(input.serialNumber || existing.serial_number),
    ratedAcInputVoltage: sanitizeText(input.ratedAcInputVoltage || existing.rated_ac_input_voltage),
    inputFrequency: sanitizeText(input.inputFrequency || existing.input_frequency),
    ratedDcVoltage: sanitizeText(input.ratedDcVoltage || existing.rated_dc_voltage),
    ratedAcOutputVoltage: sanitizeText(input.ratedAcOutputVoltage || existing.rated_ac_output_voltage),
    outputFrequency: sanitizeText(input.outputFrequency || existing.output_frequency),
    degreeOfProtection: sanitizeText(input.degreeOfProtection || existing.degree_of_protection),
    mainLabel: sanitizeText(input.mainLabel || existing.main_label),
    dtNumber: sanitizeText(input.dtNumber || existing.dt_number),
    tagNumber: sanitizeText(input.tagNumber || existing.tag_number),
    manufacturer: sanitizeText(input.manufacturer || existing.manufacturer),
    modelFamily: sanitizeText(input.modelFamily || existing.model_family),
    notes: sanitizeText(input.notes || existing.notes)
  });
}

async function ensureReportForOrder(serviceOrderId, fallbackTitle = "") {
  const existing = await repo.getReportByOrderId(serviceOrderId);
  if (existing) {
    await repo.ensureDefaultSections(existing.id);
    return existing;
  }
  const order = await repo.getOrderById(serviceOrderId);
  if (!order) {
    const err = new Error("OS nao encontrada para gerar relatorio.");
    err.statusCode = 404;
    throw err;
  }
  const reportNumber = `SR-${order.service_order_code}`;
  const created = await repo.createReport({
    serviceOrderId,
    reportNumber,
    revision: "A",
    title: fallbackTitle || `Relatorio ${order.service_order_code}`,
    status: "draft"
  });
  await repo.ensureDefaultSections(created.id);
  return created;
}

async function updateReport(id, input = {}) {
  const existing = await repo.getReportById(id);
  if (!existing) {
    const err = new Error("Relatorio nao encontrado.");
    err.statusCode = 404;
    throw err;
  }
  return repo.updateReport(id, {
    revision: sanitizeText(input.revision || existing.revision || "A"),
    title: sanitizeText(input.title || existing.title),
    status: ensureStatus(input.status || existing.status, REPORT_STATUSES, "draft"),
    issueDate: input.issueDate || existing.issue_date || null,
    preparedBy: sanitizeText(input.preparedBy || existing.prepared_by),
    reviewedBy: sanitizeText(input.reviewedBy || existing.reviewed_by),
    approvedBy: sanitizeText(input.approvedBy || existing.approved_by),
    pdfPath: sanitizeText(input.pdfPath || existing.pdf_path || "")
  });
}

async function upsertReportSection(reportId, sectionKey, sectionInput = {}) {
  const normalizedKey = String(sectionKey || "").trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalizedKey)) {
    const err = new Error("Secao invalida.");
    err.statusCode = 422;
    throw err;
  }
  const fallbackDefinition = SECTION_DEFINITIONS.find((item) => item.key === normalizedKey);
  const currentSection = await repo.getSectionByKey(reportId, normalizedKey);
  const normalizedInput = typeof sectionInput === "string"
    ? { contentHtml: sectionInput }
    : {
      sectionTitle: sectionInput.sectionTitle || sectionInput.section_title,
      sectionTitleDeltaJson: sectionInput.sectionTitleDeltaJson || sectionInput.section_title_delta_json,
      sectionTitleHtml: sectionInput.sectionTitleHtml || sectionInput.section_title_html,
      sectionTitleText: sectionInput.sectionTitleText || sectionInput.section_title_text,
      contentDeltaJson: sectionInput.contentDeltaJson || sectionInput.content_delta_json,
      contentHtml: sectionInput.contentHtml || sectionInput.content_html || sectionInput.content,
      contentText: sectionInput.contentText || sectionInput.content_text,
      imageLeftPath: sectionInput.imageLeftPath || sectionInput.image_left_path,
      imageRightPath: sectionInput.imageRightPath || sectionInput.image_right_path,
      sortOrder: sectionInput.sortOrder || sectionInput.sort_order || currentSection?.sort_order,
      isVisible: sectionInput.isVisible !== undefined ? sectionInput.isVisible : sectionInput.is_visible
    };
  const normalized = normalizeSectionContent(
    normalizedInput,
    currentSection?.section_title || fallbackDefinition?.title || normalizedKey
  );
  await repo.upsertSection(reportId, normalizedKey, normalized);
  await repo.replaceSectionImages(reportId, normalizedKey, [
    {
      filePath: normalized.imageLeftPath,
      caption: "Imagem 1",
      sortOrder: 1
    },
    {
      filePath: normalized.imageRightPath,
      caption: "Imagem 2",
      sortOrder: 2
    }
  ]);
  return repo.listSections(reportId);
}

async function createReportSection(reportId, sectionInput = {}) {
  const normalized = normalizeSectionContent(sectionInput, "NOVO CAPITULO");
  await repo.createSection(reportId, normalized);
  return repo.listSections(reportId);
}

async function deleteReportSection(reportId, sectionKey) {
  const normalizedKey = String(sectionKey || "").trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalizedKey)) {
    const err = new Error("Secao invalida.");
    err.statusCode = 422;
    throw err;
  }
  await repo.deleteImagesBySection(reportId, normalizedKey);
  const deleted = await repo.deleteSection(reportId, normalizedKey);
  if (!deleted) {
    const err = new Error("Secao nao encontrada.");
    err.statusCode = 404;
    throw err;
  }
  return repo.listSections(reportId);
}

async function createComponent(reportId, input = {}) {
  const category = sanitizeText(input.category).toLowerCase();
  if (!COMPONENT_CATEGORIES.includes(category)) {
    const err = new Error("Categoria de componente invalida.");
    err.statusCode = 422;
    throw err;
  }
  if (!sanitizeText(input.description)) {
    const err = new Error("Descricao do componente e obrigatoria.");
    err.statusCode = 422;
    throw err;
  }
  return repo.createComponent({
    serviceReportId: reportId,
    category,
    equipmentId: repo.toInt(input.equipmentId),
    quantity: Number(input.quantity || 1),
    description: sanitizeText(input.description),
    partNumber: sanitizeText(input.partNumber),
    notes: sanitizeText(input.notes),
    sortOrder: Number(input.sortOrder || 0)
  });
}

async function updateComponent(id, input = {}) {
  return repo.updateComponent(id, {
    category: sanitizeText(input.category).toLowerCase(),
    equipmentId: repo.toInt(input.equipmentId),
    quantity: Number(input.quantity || 1),
    description: sanitizeText(input.description),
    partNumber: sanitizeText(input.partNumber),
    notes: sanitizeText(input.notes),
    sortOrder: Number(input.sortOrder || 0)
  });
}

async function createSignature(reportId, input = {}) {
  const signerType = sanitizeText(input.signerType).toLowerCase();
  const signerName = sanitizeText(input.signerName);
  if (!SIGNER_TYPES.includes(signerType)) {
    const err = new Error("Tipo de assinatura invalido.");
    err.statusCode = 422;
    throw err;
  }
  if (!signerName) {
    const err = new Error("Assinatura exige nome do signatario.");
    err.statusCode = 422;
    throw err;
  }
  return repo.createSignature({
    serviceReportId: reportId,
    signerType,
    signerName,
    signerRole: sanitizeText(input.signerRole),
    signerCompany: sanitizeText(input.signerCompany),
    signatureData: sanitizeText(input.signatureData),
    signatureFilePath: sanitizeText(input.signatureFilePath)
  });
}

async function buildReportAggregate(serviceReportId) {
  const report = await repo.getReportById(serviceReportId);
  if (!report) return null;
  const order = await repo.getOrderById(report.service_order_id);
  const customer = order ? await repo.getCustomerById(order.customer_id) : null;
  const site = order && order.site_id ? await repo.getSiteById(order.site_id) : null;
  const sections = await repo.listSections(serviceReportId);
  const components = await repo.listComponents(serviceReportId);
  const signatures = await repo.listSignatures(serviceReportId);
  const instruments = await repo.listInstruments(serviceReportId);
  const technicians = await repo.listTechnicians(serviceReportId);
  const images = await repo.listImages(serviceReportId);
  const timesheet = order ? await repo.listTimesheetByOrder(order.id) : [];
  const dailyLogs = order ? await repo.listDailyLogsByOrder(order.id) : [];
  const orderEquipments = order ? await repo.listOrderEquipments(order.id) : [];

  return {
    report,
    order,
    customer,
    site,
    sections,
    components,
    signatures,
    instruments,
    technicians,
    images,
    timesheet,
    dailyLogs,
    orderEquipments
  };
}

function resolveReportPdfPath(serviceReportId) {
  const folder = path.join(process.cwd(), "dados", "service-report-pdfs");
  fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, `service-report-${serviceReportId}.pdf`);
}

function resolveReportHtmlPath(serviceReportId) {
  const folder = path.join(process.cwd(), "dados", "service-report-html");
  fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, `service-report-${serviceReportId}.html`);
}

module.exports = {
  ORDER_STATUSES,
  SECTION_DEFINITIONS,
  createOrder,
  updateOrder,
  createCustomer,
  createSite,
  createEquipment,
  updateEquipment,
  ensureReportForOrder,
  updateReport,
  upsertReportSection,
  createReportSection,
  deleteReportSection,
  createComponent,
  updateComponent,
  createSignature,
  buildReportAggregate,
  resolveReportPdfPath,
  resolveReportHtmlPath
};
