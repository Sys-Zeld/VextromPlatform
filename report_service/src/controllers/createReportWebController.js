const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const repo = require("../repositories/serviceReportRepository");
const service = require("../services/serviceReportService");
const { generatePdfToFile, buildPdfBufferFromHtml } = require("../services/serviceReportPdfService");
const { getReportConfigSettings, saveReportConfigSettings } = require("../services/reportConfigSettings");
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

function createReportWebController(deps) {
  const sanitizeInput = deps.sanitizeInput;
  const sanitizeRichTextInput = deps.sanitizeRichTextInput || deps.sanitizeInput;
  const reviseTextWithAi = deps.reviseTextWithAi;
  const hasValidRequiredFk = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
  const buildTemplatePreviewRoute = (orderId, templateKey) => `/admin/report-service/orders/${orderId}/preview-html/template/${normalizeReportTemplateKey(templateKey)}`;

  async function loadOrderEditorData(orderId) {
    const order = await repo.getOrderById(orderId);
    if (!order) return null;
    const report = await service.ensureReportForOrder(orderId, order.title);
    const [
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
      repo.listTechnicians(report.id),
      repo.listInstruments(report.id),
      repo.listImages(report.id)
    ]);
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
      images
    };
  }

  async function resolveRenderConfig(reqTemplateKey = "", explicitConfig = null) {
    const reportConfig = explicitConfig || await getReportConfigSettings();
    const templateKey = normalizeReportTemplateKey(reqTemplateKey || reportConfig.templateKey);
    return { reportConfig, templateKey };
  }

  return {
    async home(_req, res) {
      return res.redirect("/admin/report-service/orders");
    },

    async listOrders(req, res) {
      const [orders, customers] = await Promise.all([
        repo.listOrders(),
        repo.listCustomers()
      ]);
      const ordersView = orders.map((order) => withServiceOrderDisplay(order));
      return res.render("report-service/orders", {
        pageTitle: "Service Report - Ordens de Servico",
        orders: ordersView,
        customers,
        created: req.query.created === "1",
        deleted: req.query.deleted === "1",
        csrfToken: req.csrfToken()
      });
    },

    async createOrder(req, res) {
      await service.createOrder({
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        title: req.body.title,
        description: req.body.description,
        status: req.body.status,
        openingDate: req.body.opening_date,
        createdBy: res.locals.adminUsername || ""
      });
      return res.redirect("/admin/report-service/orders?created=1");
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
        notes: req.body.notes
      });
      return res.redirect("/admin/report-service/customers?created=1");
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

    async createEquipment(req, res) {
      if (!hasValidRequiredFk(req.body.customer_id)) {
        return res.status(422).send("Cliente e obrigatorio.");
      }
      if (!hasValidRequiredFk(req.body.site_id)) {
        return res.status(422).send("Site e obrigatorio.");
      }

      await service.createEquipment({
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        type: req.body.type,
        yearOfManufacture: req.body.year_of_manufacture,
        serialNumber: req.body.serial_number,
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

      const updated = await service.updateEquipment(equipmentId, {
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        type: req.body.type,
        yearOfManufacture: req.body.year_of_manufacture,
        serialNumber: req.body.serial_number,
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

      const updated = await service.updateEquipment(equipmentId, {
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        type: req.body.type,
        yearOfManufacture: req.body.year_of_manufacture,
        serialNumber: req.body.serial_number,
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
      const created = await service.createEquipment({
        customerId: req.body.customer_id,
        siteId: req.body.site_id,
        type: req.body.type || "Novo Equipamento",
        yearOfManufacture: req.body.year_of_manufacture,
        serialNumber: req.body.serial_number,
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
      const data = await loadOrderEditorData(orderId);
      if (!data) return res.status(404).send("OS nao encontrada.");
      const orderView = withServiceOrderDisplay(data.order);
      const reportConfig = await getReportConfigSettings();
      return res.render("report-service/order-editor", {
        pageTitle: `Service Report - ${orderView.service_order_display || orderView.service_order_code || "-"}`,
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
        saved: req.query.saved === "1",
        csrfToken: req.csrfToken()
      });
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
        templateKey: sanitizeInput(req.body.template_key)
      });
      return res.redirect("/admin/report-service/config?saved=1");
    },

    async attachEquipment(req, res) {
      const orderId = Number(req.params.id);
      await repo.attachEquipmentToOrder(orderId, Number(req.body.equipment_id), sanitizeInput(req.body.notes));
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async addTimesheet(req, res) {
      const orderId = Number(req.params.id);
      await repo.createTimesheetEntry({
        serviceOrderId: orderId,
        activityDate: sanitizeInput(req.body.activity_date),
        checkInBase: sanitizeInput(req.body.check_in_base),
        checkInClient: sanitizeInput(req.body.check_in_client),
        checkOutClient: sanitizeInput(req.body.check_out_client),
        checkOutBase: sanitizeInput(req.body.check_out_base),
        technicianName: sanitizeInput(req.body.technician_name),
        workedHours: req.body.worked_hours ? Number(req.body.worked_hours) : null,
        notes: sanitizeInput(req.body.notes)
      });
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async addDailyLog(req, res) {
      const orderId = Number(req.params.id);
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
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async deleteDailyLog(req, res) {
      const orderId = Number(req.params.id);
      const dailyLogId = Number(req.params.dailyLogId || 0);
      if (Number.isInteger(dailyLogId) && dailyLogId > 0) {
        await repo.deleteDailyLogByOrderAndId(orderId, dailyLogId);
      }
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
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
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async createSection(req, res) {
      const orderId = Number(req.params.id);
      const report = await service.ensureReportForOrder(orderId);
      await service.createReportSection(report.id, {
        sectionTitle: sanitizeInput(req.body.section_title) || "NOVO CAPITULO",
        sectionTitleText: sanitizeInput(req.body.section_title) || "NOVO CAPITULO",
        contentText: "",
        contentHtml: "<p><br></p>",
        isVisible: true
      });
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async deleteSection(req, res) {
      const orderId = Number(req.params.id);
      const sectionKey = sanitizeInput(req.params.sectionKey).toLowerCase();
      const report = await service.ensureReportForOrder(orderId);
      await service.deleteReportSection(report.id, sectionKey);
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async addComponent(req, res) {
      const orderId = Number(req.params.id);
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
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async addSignature(req, res) {
      const orderId = Number(req.params.id);
      const report = await service.ensureReportForOrder(orderId);
      await service.createSignature(report.id, {
        signerType: req.body.signer_type,
        signerName: req.body.signer_name,
        signerRole: req.body.signer_role,
        signerCompany: req.body.signer_company,
        signatureData: req.body.signature_data
      });
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async addTechnician(req, res) {
      const orderId = Number(req.params.id);
      const report = await service.ensureReportForOrder(orderId);
      await repo.createTechnician({
        serviceReportId: report.id,
        name: sanitizeInput(req.body.name),
        role: sanitizeInput(req.body.role),
        company: sanitizeInput(req.body.company),
        email: sanitizeInput(req.body.email),
        phone: sanitizeInput(req.body.phone),
        isLead: req.body.is_lead === "true"
      });
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async addInstrument(req, res) {
      const orderId = Number(req.params.id);
      const report = await service.ensureReportForOrder(orderId);
      await repo.createInstrument({
        serviceReportId: report.id,
        name: sanitizeInput(req.body.name),
        model: sanitizeInput(req.body.model),
        serialNumber: sanitizeInput(req.body.serial_number),
        calibrationDueDate: sanitizeInput(req.body.calibration_due_date) || null,
        notes: sanitizeInput(req.body.notes)
      });
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
    },

    async importImage(req, res) {
      const orderId = Number(req.params.id);
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

      const targetDir = path.join(process.cwd(), "docs", "report", "img");
      fs.mkdirSync(targetDir, { recursive: true });
      const fileSafeBase = path.basename(fileNameBase, extFromName || path.extname(fileNameBase)).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "imagem";
      const unique = crypto.randomBytes(6).toString("hex");
      const finalName = `${Date.now()}-${fileSafeBase}-${unique}${ext === ".jpeg" ? ".jpg" : ext}`;
      const absolutePath = path.join(targetDir, finalName);
      fs.writeFileSync(absolutePath, buffer);

      const created = await repo.createImage({
        serviceReportId: report.id,
        sectionKey: "__tag__",
        filePath: finalName,
        caption: sanitizeInput(req.headers["x-caption"] || ""),
        sortOrder: 0
      });

      return res.status(201).json({
        ok: true,
        data: {
          id: created.ref_id,
          filePath: finalName
        }
      });
    },

    async deleteImage(req, res) {
      const orderId = Number(req.params.id);
      const imageId = Number(req.params.imageId);
      const report = await service.ensureReportForOrder(orderId);
      await repo.deleteImageByRefId(report.id, imageId);
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${String(pageTitle).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>
  <link href="/public/css/report-preview.css" rel="stylesheet" />
  <link href="/public/css/report-print.css" rel="stylesheet" />
  <style>
    .report-print-btn {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      padding: 10px 20px;
      background: #4f7d33;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .report-print-btn:hover { background: #3d6228; }
    @media print { .report-print-btn { display: none !important; } }
  </style>
</head>
<body>
<button class="report-print-btn" onclick="window.print()">&#128424; Imprimir</button>
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
      const { reportConfig, templateKey } = await resolveRenderConfig("", null);
      const htmlSource = await renderReportPreviewHtml(payload, { reportConfig, templateKey });
      const buffer = await buildPdfBufferFromHtml(htmlSource, payload);
      res.setHeader("Content-Type", "application/pdf");
      return res.send(buffer);
    },

    async generatePdf(req, res) {
      const orderId = Number(req.params.id);
      const report = await service.ensureReportForOrder(orderId);
      const payload = await service.buildReportAggregate(report.id);
      if (!payload) return res.status(404).send("Relatorio nao encontrado.");
      const outputPath = service.resolveReportPdfPath(report.id);
      const { reportConfig, templateKey } = await resolveRenderConfig("", null);
      const htmlSource = await renderReportPreviewHtml(payload, { reportConfig, templateKey });
      fs.writeFileSync(service.resolveReportHtmlPath(report.id), htmlSource, "utf8");
      await generatePdfToFile(payload, outputPath, htmlSource);
      await service.updateReport(report.id, {
        pdfPath: outputPath,
        status: "issued",
        issueDate: new Date().toISOString().slice(0, 10)
      });
      return res.redirect(`/admin/report-service/orders/${orderId}?saved=1`);
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
