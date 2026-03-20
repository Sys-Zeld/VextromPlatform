const fs = require("fs");
const repo = require("../repositories/serviceReportRepository");
const service = require("../services/serviceReportService");
const { generatePdfToFile, buildPdfBufferFromHtml } = require("../services/serviceReportPdfService");
const { buildPreviewModel } = require("../services/reportPreviewService");
const { renderReportPreviewHtml } = require("../services/reportTemplateService");

function ok(res, data, statusCode = 200) {
  return res.status(statusCode).json({ data });
}

function createReportApiController(deps) {
  const sanitizeInput = deps.sanitizeInput;

  return {
    async health(_req, res) {
      return ok(res, {
        service: "service-report",
        status: "ok",
        now: new Date().toISOString()
      });
    },

    async listOrders(_req, res) {
      return ok(res, await repo.listOrders());
    },

    async getOrder(req, res) {
      const id = Number(req.params.id);
      const order = await repo.getOrderById(id);
      if (!order) return res.status(404).json({ error: "OS nao encontrada.", errorCode: "ORDER_NOT_FOUND", details: null });
      return ok(res, order);
    },

    async createOrder(req, res) {
      const created = await service.createOrder(req.body || {});
      return ok(res, created, 201);
    },

    async updateOrder(req, res) {
      const id = Number(req.params.id);
      const updated = await service.updateOrder(id, req.body || {});
      return ok(res, updated);
    },

    async deleteOrder(req, res) {
      const id = Number(req.params.id);
      const deleted = await repo.deleteOrder(id);
      if (!deleted) return res.status(404).json({ error: "OS nao encontrada.", errorCode: "ORDER_NOT_FOUND", details: null });
      return res.status(204).send();
    },

    async listCustomers(_req, res) {
      return ok(res, await repo.listCustomers());
    },

    async createCustomer(req, res) {
      const created = await service.createCustomer(req.body || {});
      return ok(res, created, 201);
    },

    async getCustomer(req, res) {
      const id = Number(req.params.id);
      const customer = await repo.getCustomerById(id);
      if (!customer) return res.status(404).json({ error: "Cliente nao encontrado.", errorCode: "CUSTOMER_NOT_FOUND", details: null });
      return ok(res, customer);
    },

    async updateCustomer(req, res) {
      const id = Number(req.params.id);
      const current = await repo.getCustomerById(id);
      if (!current) return res.status(404).json({ error: "Cliente nao encontrado.", errorCode: "CUSTOMER_NOT_FOUND", details: null });
      const updated = await repo.updateCustomer(id, {
        name: sanitizeInput(req.body.name || current.name),
        customerType: sanitizeInput(req.body.customerType || current.customer_type),
        notes: sanitizeInput(req.body.notes || current.notes)
      });
      return ok(res, updated);
    },

    async listSites(req, res) {
      const customerId = Number(req.query.customer_id || 0);
      const data = await repo.listSites(customerId > 0 ? { customerId } : {});
      return ok(res, data);
    },

    async createSite(req, res) {
      const created = await service.createSite(req.body || {});
      return ok(res, created, 201);
    },

    async listEquipments(_req, res) {
      return ok(res, await repo.listEquipments());
    },

    async createEquipment(req, res) {
      const created = await service.createEquipment(req.body || {});
      return ok(res, created, 201);
    },

    async getEquipment(req, res) {
      const id = Number(req.params.id);
      const equipment = await repo.getEquipmentById(id);
      if (!equipment) return res.status(404).json({ error: "Equipamento nao encontrado.", errorCode: "EQUIPMENT_NOT_FOUND", details: null });
      return ok(res, equipment);
    },

    async updateEquipment(req, res) {
      const id = Number(req.params.id);
      const updated = await service.updateEquipment(id, req.body || {});
      return ok(res, updated);
    },

    async listTimesheet(req, res) {
      const orderId = Number(req.params.id);
      return ok(res, await repo.listTimesheetByOrder(orderId));
    },

    async createTimesheet(req, res) {
      const orderId = Number(req.params.id);
      const created = await repo.createTimesheetEntry({
        serviceOrderId: orderId,
        activityDate: sanitizeInput(req.body.activityDate),
        checkInBase: sanitizeInput(req.body.checkInBase),
        checkInClient: sanitizeInput(req.body.checkInClient),
        checkOutClient: sanitizeInput(req.body.checkOutClient),
        checkOutBase: sanitizeInput(req.body.checkOutBase),
        technicianName: sanitizeInput(req.body.technicianName),
        workedHours: req.body.workedHours ? Number(req.body.workedHours) : null,
        notes: sanitizeInput(req.body.notes)
      });
      return ok(res, created, 201);
    },

    async updateTimesheet(req, res) {
      const id = Number(req.params.entryId);
      const updated = await repo.updateTimesheetEntry(id, {
        activityDate: sanitizeInput(req.body.activityDate),
        checkInBase: sanitizeInput(req.body.checkInBase),
        checkInClient: sanitizeInput(req.body.checkInClient),
        checkOutClient: sanitizeInput(req.body.checkOutClient),
        checkOutBase: sanitizeInput(req.body.checkOutBase),
        technicianName: sanitizeInput(req.body.technicianName),
        workedHours: req.body.workedHours ? Number(req.body.workedHours) : null,
        notes: sanitizeInput(req.body.notes)
      });
      if (!updated) return res.status(404).json({ error: "Timesheet nao encontrado.", errorCode: "TIMESHEET_NOT_FOUND", details: null });
      return ok(res, updated);
    },

    async deleteTimesheet(req, res) {
      const id = Number(req.params.entryId);
      const deleted = await repo.deleteTimesheetEntry(id);
      if (!deleted) return res.status(404).json({ error: "Timesheet nao encontrado.", errorCode: "TIMESHEET_NOT_FOUND", details: null });
      return res.status(204).send();
    },

    async listReports(_req, res) {
      return ok(res, await repo.listReports());
    },

    async createReport(req, res) {
      const serviceOrderId = Number(req.body.serviceOrderId || 0);
      const report = await service.ensureReportForOrder(serviceOrderId, sanitizeInput(req.body.title));
      return ok(res, report, 201);
    },

    async getReport(req, res) {
      const id = Number(req.params.id);
      const data = await service.buildReportAggregate(id);
      if (!data) return res.status(404).json({ error: "Relatorio nao encontrado.", errorCode: "REPORT_NOT_FOUND", details: null });
      return ok(res, data);
    },

    async updateReport(req, res) {
      const id = Number(req.params.id);
      const updated = await service.updateReport(id, req.body || {});
      return ok(res, updated);
    },

    async listSections(req, res) {
      const reportId = Number(req.params.id);
      return ok(res, await repo.listSections(reportId));
    },

    async createSection(req, res) {
      const reportId = Number(req.params.id);
      const sections = await service.createReportSection(reportId, {
        sectionTitle: sanitizeInput(req.body.section_title || req.body.sectionTitle || "NOVO CAPITULO"),
        sectionTitleText: sanitizeInput(req.body.section_title_text || req.body.sectionTitleText || req.body.section_title || req.body.sectionTitle),
        sectionTitleDeltaJson: req.body.section_title_delta_json || req.body.sectionTitleDeltaJson,
        sectionTitleHtml: req.body.section_title_html || req.body.sectionTitleHtml,
        contentDeltaJson: req.body.content_delta_json || req.body.contentDeltaJson,
        contentHtml: req.body.content_html || req.body.contentHtml || req.body.content,
        contentText: sanitizeInput(req.body.content_text || req.body.contentText),
        imageLeftPath: sanitizeInput(req.body.image_left_path || req.body.imageLeftPath),
        imageRightPath: sanitizeInput(req.body.image_right_path || req.body.imageRightPath),
        isVisible: req.body.is_visible !== undefined ? req.body.is_visible : req.body.isVisible
      });
      return ok(res, sections, 201);
    },

    async getSection(req, res) {
      const reportId = Number(req.params.id);
      const sectionKey = sanitizeInput(req.params.sectionKey).toLowerCase();
      const section = await repo.getSectionByKey(reportId, sectionKey);
      if (!section) return res.status(404).json({ error: "Secao nao encontrada.", errorCode: "SECTION_NOT_FOUND", details: null });
      return ok(res, section);
    },

    async updateSection(req, res) {
      const reportId = Number(req.params.id);
      const sectionKey = sanitizeInput(req.params.sectionKey).toLowerCase();
      const sections = await service.upsertReportSection(reportId, sectionKey, {
        sectionTitle: sanitizeInput(req.body.section_title || req.body.sectionTitle),
        sectionTitleDeltaJson: req.body.section_title_delta_json || req.body.sectionTitleDeltaJson,
        sectionTitleHtml: req.body.section_title_html || req.body.sectionTitleHtml,
        sectionTitleText: sanitizeInput(req.body.section_title_text || req.body.sectionTitleText),
        contentDeltaJson: req.body.content_delta_json || req.body.contentDeltaJson,
        contentHtml: req.body.content_html || req.body.contentHtml || req.body.content,
        contentText: sanitizeInput(req.body.content_text || req.body.contentText),
        imageLeftPath: sanitizeInput(req.body.image_left_path || req.body.imageLeftPath),
        imageRightPath: sanitizeInput(req.body.image_right_path || req.body.imageRightPath),
        isVisible: req.body.is_visible !== undefined ? req.body.is_visible : req.body.isVisible
      });
      return ok(res, sections);
    },

    async deleteSection(req, res) {
      const reportId = Number(req.params.id);
      const sectionKey = sanitizeInput(req.params.sectionKey).toLowerCase();
      await service.deleteReportSection(reportId, sectionKey);
      return res.status(204).send();
    },

    async listComponents(req, res) {
      const reportId = Number(req.params.id);
      return ok(res, await repo.listComponents(reportId));
    },

    async createComponent(req, res) {
      const reportId = Number(req.params.id);
      const created = await service.createComponent(reportId, req.body || {});
      return ok(res, created, 201);
    },

    async updateComponent(req, res) {
      const id = Number(req.params.id);
      const updated = await service.updateComponent(id, req.body || {});
      if (!updated) return res.status(404).json({ error: "Componente nao encontrado.", errorCode: "COMPONENT_NOT_FOUND", details: null });
      return ok(res, updated);
    },

    async deleteComponent(req, res) {
      const id = Number(req.params.id);
      const deleted = await repo.deleteComponent(id);
      if (!deleted) return res.status(404).json({ error: "Componente nao encontrado.", errorCode: "COMPONENT_NOT_FOUND", details: null });
      return res.status(204).send();
    },

    async createSignature(req, res) {
      const reportId = Number(req.params.id);
      const created = await service.createSignature(reportId, req.body || {});
      return ok(res, created, 201);
    },

    async listSignatures(req, res) {
      const reportId = Number(req.params.id);
      return ok(res, await repo.listSignatures(reportId));
    },

    async pdfPreview(req, res) {
      const reportId = Number(req.params.id);
      const aggregate = await service.buildReportAggregate(reportId);
      if (!aggregate) return res.status(404).json({ error: "Relatorio nao encontrado.", errorCode: "REPORT_NOT_FOUND", details: null });
      const htmlSource = await renderReportPreviewHtml(aggregate);
      const buffer = await buildPdfBufferFromHtml(htmlSource, aggregate);
      res.setHeader("Content-Type", "application/pdf");
      return res.send(buffer);
    },

    async generatePdf(req, res) {
      const reportId = Number(req.params.id);
      const aggregate = await service.buildReportAggregate(reportId);
      if (!aggregate) return res.status(404).json({ error: "Relatorio nao encontrado.", errorCode: "REPORT_NOT_FOUND", details: null });
      const outputPath = service.resolveReportPdfPath(reportId);
      const htmlSource = await renderReportPreviewHtml(aggregate);
      fs.writeFileSync(service.resolveReportHtmlPath(reportId), htmlSource, "utf8");
      await generatePdfToFile(aggregate, outputPath, htmlSource);
      await service.updateReport(reportId, { pdfPath: outputPath, status: "issued", issueDate: new Date().toISOString().slice(0, 10) });
      return ok(res, {
        reportId,
        outputPath
      }, 201);
    },

    async getStatus(req, res) {
      const reportId = Number(req.params.id);
      const report = await repo.getReportById(reportId);
      if (!report) return res.status(404).json({ error: "Relatorio nao encontrado.", errorCode: "REPORT_NOT_FOUND", details: null });
      return ok(res, {
        id: report.id,
        status: report.status,
        revision: report.revision,
        lastModifiedAt: report.last_modified_at
      });
    },

    async previewData(req, res) {
      const reportId = Number(req.params.id);
      const aggregate = await service.buildReportAggregate(reportId);
      if (!aggregate) return res.status(404).json({ error: "Relatorio nao encontrado.", errorCode: "REPORT_NOT_FOUND", details: null });
      return ok(res, buildPreviewModel(aggregate));
    }
  };
}

module.exports = {
  createReportApiController
};
