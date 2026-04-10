const express = require("express");
const { createReportWebController } = require("../controllers/createReportWebController");
const { createAnalyticsWebController } = require("../controllers/analyticsController");

function createReportServiceWebRouter(deps) {
  const router = express.Router();
  const asyncHandler = deps.asyncHandler;
  const controller = createReportWebController(deps);
  const analyticsController = createAnalyticsWebController(deps);

  router.get("/", deps.requireAdminAuth, asyncHandler(controller.home));
  router.get("/analytics", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(analyticsController.dashboard));
  router.get("/analytics/data", deps.requireAdminAuth, asyncHandler(analyticsController.dashboardData));
  router.get("/analytics/export-pdf", deps.requireAdminAuth, asyncHandler(analyticsController.exportPdf));
  router.get("/orders", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.listOrders));
  router.post("/orders", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createOrder));
  router.post("/orders/:id/update-registration", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateOrderRegistration));
  router.post("/orders/:id/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteOrder));
  router.post("/orders/:id/validate-os", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.validateOrder));
  router.post("/orders/:id/revalidate-os", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.revalidateOrder));
  router.get("/orders/:id", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.orderEditor));
  router.get("/orders/:id/report-editor", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.reportOrderEditor));
  router.get("/orders/:id/sign-report", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.signReportPage));
  router.post("/orders/:id/sign-report", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.signReport));
  router.get("/config", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.reportConfigPage));
  router.post("/config", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.saveReportConfig));
  router.post(
    "/config/logo-upload",
    express.raw({ type: ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "application/octet-stream"], limit: "5mb" }),
    deps.csrfProtection,
    deps.requireAdminAuth,
    asyncHandler(controller.uploadConfigLogo)
  );
  router.post(
    "/config/image-upload",
    express.raw({ type: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "application/octet-stream"], limit: "10mb" }),
    deps.csrfProtection,
    deps.requireAdminAuth,
    asyncHandler(controller.uploadConfigImage)
  );
  router.post("/orders/:id/equipments", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.attachEquipment));
  router.post("/orders/:id/equipments/:equipmentId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.detachEquipment));
  router.post("/orders/:id/timesheet", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addTimesheet));
  router.post("/orders/:id/timesheet/:entryId/update", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateTimesheet));
  router.post("/orders/:id/timesheet/:entryId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteTimesheet));
  router.post("/orders/:id/daily-logs", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addDailyLog));
  router.post("/orders/:id/daily-logs/:dailyLogId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteDailyLog));
  router.post("/orders/:id/daily-logs/revise-text", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.reviseDailyLogText));
  router.post("/orders/:id/daily-logs/generate-conclusion", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.generateConclusionFromLogs));
  router.post("/orders/:id/sections/revise-text", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.reviseSectionText));
  router.post("/orders/:id/translate", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.translateReport));
  router.post("/orders/:id/translate/start", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.startTranslateReportJob));
  router.get("/orders/:id/translate/jobs/:jobId", deps.requireAdminAuth, asyncHandler(controller.getTranslateReportJob));
  router.post("/orders/:id/sections", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createSection));
  router.post("/orders/:id/sections/reorder", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.reorderSections));
  router.post("/orders/:id/sections/:sectionKey", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.saveSection));
  router.post("/orders/:id/sections/:sectionKey/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteSection));
  router.post("/orders/:id/components", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addComponent));
  router.post("/orders/:id/components/:componentId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteComponent));
  router.post("/orders/:id/signatures", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addSignature));
  router.post("/orders/:id/signatures/:signatureId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteSignature));
  router.post("/orders/:id/sign-requests", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createSignRequest));
  router.post("/orders/:id/sign-requests/:requestId/update", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateSignRequest));
  router.post("/orders/:id/sign-requests/:requestId/cancel", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.cancelSignRequest));
  router.post("/orders/:id/sign-requests/:requestId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteSignRequest));
  router.post("/orders/:id/send-signed-email", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.sendSignedReportByEmail));
  router.post("/orders/:id/send-os-email", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.sendOsCreatedEmail));
  router.get("/assets", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.listAssetsGlobal));
  router.post("/assets/technicians", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createGlobalTechnician));
  router.post("/assets/technicians/:techId/update", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateGlobalTechnician));
  router.post("/assets/technicians/:techId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteGlobalTechnician));
  router.post("/assets/instruments", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createGlobalInstrument));
  router.post("/assets/instruments/:instrId/update", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateGlobalInstrument));
  router.post("/assets/instruments/:instrId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteGlobalInstrument));

  router.get("/orders/:id/assets", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.assetsEditor));
  router.post("/orders/:id/assets/technicians/link", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.linkTechnicianToOrder));
  router.post("/orders/:id/assets/technicians/:techId/unlink", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.unlinkTechnicianFromOrder));
  router.post("/orders/:id/assets/instruments/link", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.linkInstrumentToOrder));
  router.post("/orders/:id/assets/instruments/:instrId/unlink", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.unlinkInstrumentFromOrder));
  router.post("/orders/:id/technicians", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addTechnician));
  router.post("/orders/:id/technicians/link", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.linkTechnicianToOrderEditor));
  router.post("/orders/:id/technicians/:techId/unlink", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.unlinkTechnicianFromOrderEditor));
  router.post("/orders/:id/instruments", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addInstrument));
  router.post(
    "/orders/:id/images/import",
    express.raw({ type: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "application/octet-stream"], limit: "10mb" }),
    deps.csrfProtection,
    deps.requireAdminAuth,
    asyncHandler(controller.importImage)
  );
  router.post("/orders/:id/images/:imageId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteImage));
  router.get("/orders/:id/preview", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.previewPage));
  router.get("/orders/:id/preview-html", deps.requireAdminAuth, asyncHandler(controller.previewHtmlPage));
  router.get("/orders/:id/preview-html/template/:templateKey", deps.requireAdminAuth, asyncHandler(controller.previewHtmlByTemplatePage));
  router.get("/orders/:id/pdf-preview", deps.requireAdminAuth, asyncHandler(controller.pdfPreview));
  router.post("/orders/:id/generate-pdf", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.generatePdf));
  router.get("/reports/:id/editor", deps.requireAdminAuth, asyncHandler(controller.reportEditor));
  router.get("/reports/:id/preview", deps.requireAdminAuth, asyncHandler(controller.reportPreview));
  router.post("/reports/:id/generate-pdf", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.reportGeneratePdf));

  router.get("/customers", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.listCustomers));
  router.post("/customers", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createCustomer));
  router.post("/customers/:id/update", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateCustomer));
  router.post("/customers/:id/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteCustomer));
  router.post("/sites", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createSite));
  router.post("/sites/:id/update", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateSite));
  router.post("/sites/:id/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteSite));

  router.get("/equipments", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.listEquipments));
  router.post("/equipments", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createEquipment));
  router.post("/equipments/create-inline", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createEquipmentInline));
  router.post("/equipments/:id/update", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateEquipment));
  router.post("/equipments/:id/update-inline", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateEquipmentInline));
  router.post("/equipments/:id/delete-inline", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteEquipmentInline));

  router.get("/spare-parts", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.listSpareParts));
  router.get("/spare-parts/ai-config", deps.requireAdminAuth, asyncHandler(controller.getSparePartsAiConfig));
  router.post("/spare-parts", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createSparePart));
  router.post("/spare-parts/ai-extract", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.extractSparePartsFromPdf));
  router.post("/spare-parts/bulk-import", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.bulkImportSpareParts));
  router.post("/spare-parts/:id/update", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateSparePart));
  router.post("/spare-parts/:id/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteSparePart));
  router.post("/spare-parts/equipment-links", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.linkSparePartToEquipment));
  router.post("/spare-parts/equipment-links/auto-family", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.autoLinkSparePartsByFamily));
  router.post("/spare-parts/equipment-links/:equipmentId/:sparePartId/quantity", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.updateSparePartQuantityByEquipment));
  router.post("/spare-parts/equipment-links/:equipmentId/:sparePartId/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.unlinkSparePartFromEquipment));

  return router;
}

module.exports = {
  createReportServiceWebRouter
};
