const express = require("express");
const { createReportApiController } = require("../controllers/createReportApiController");

function createReportServiceApiRouter(deps) {
  const router = express.Router();
  const asyncHandler = deps.asyncHandler;
  const controller = createReportApiController(deps);
  const readAccess = deps.requireApiScope("report-service:read");
  const writeAccess = deps.requireApiScope("report-service:write");

  router.get("/health", readAccess, asyncHandler(controller.health));

  router.get("/orders", readAccess, asyncHandler(controller.listOrders));
  router.get("/orders/:id", readAccess, asyncHandler(controller.getOrder));
  router.post("/orders", writeAccess, asyncHandler(controller.createOrder));
  router.put("/orders/:id", writeAccess, asyncHandler(controller.updateOrder));
  router.delete("/orders/:id", writeAccess, asyncHandler(controller.deleteOrder));

  router.get("/customers", readAccess, asyncHandler(controller.listCustomers));
  router.post("/customers", writeAccess, asyncHandler(controller.createCustomer));
  router.get("/customers/:id", readAccess, asyncHandler(controller.getCustomer));
  router.put("/customers/:id", writeAccess, asyncHandler(controller.updateCustomer));

  router.get("/sites", readAccess, asyncHandler(controller.listSites));
  router.post("/sites", writeAccess, asyncHandler(controller.createSite));

  router.get("/equipments", readAccess, asyncHandler(controller.listEquipments));
  router.post("/equipments", writeAccess, asyncHandler(controller.createEquipment));
  router.get("/equipments/:id", readAccess, asyncHandler(controller.getEquipment));
  router.put("/equipments/:id", writeAccess, asyncHandler(controller.updateEquipment));

  router.get("/orders/:id/timesheet", readAccess, asyncHandler(controller.listTimesheet));
  router.post("/orders/:id/timesheet", writeAccess, asyncHandler(controller.createTimesheet));
  router.put("/timesheet/:entryId", writeAccess, asyncHandler(controller.updateTimesheet));
  router.delete("/timesheet/:entryId", writeAccess, asyncHandler(controller.deleteTimesheet));

  router.get("/reports", readAccess, asyncHandler(controller.listReports));
  router.post("/reports", writeAccess, asyncHandler(controller.createReport));
  router.get("/reports/:id", readAccess, asyncHandler(controller.getReport));
  router.put("/reports/:id", writeAccess, asyncHandler(controller.updateReport));

  router.get("/reports/:id/sections", readAccess, asyncHandler(controller.listSections));
  router.post("/reports/:id/sections", writeAccess, asyncHandler(controller.createSection));
  router.get("/reports/:id/sections/:sectionKey", readAccess, asyncHandler(controller.getSection));
  router.put("/reports/:id/sections/:sectionKey", writeAccess, asyncHandler(controller.updateSection));
  router.delete("/reports/:id/sections/:sectionKey", writeAccess, asyncHandler(controller.deleteSection));
  router.get("/reports/:id/preview-data", readAccess, asyncHandler(controller.previewData));

  router.get("/reports/:id/components", readAccess, asyncHandler(controller.listComponents));
  router.post("/reports/:id/components", writeAccess, asyncHandler(controller.createComponent));
  router.put("/components/:id", writeAccess, asyncHandler(controller.updateComponent));
  router.delete("/components/:id", writeAccess, asyncHandler(controller.deleteComponent));

  router.post("/reports/:id/signatures", writeAccess, asyncHandler(controller.createSignature));
  router.get("/reports/:id/signatures", readAccess, asyncHandler(controller.listSignatures));

  router.get("/reports/:id/pdf-preview", readAccess, asyncHandler(controller.pdfPreview));
  router.post("/reports/:id/generate-pdf", writeAccess, asyncHandler(controller.generatePdf));
  router.get("/status/:id", readAccess, asyncHandler(controller.getStatus));

  return router;
}

module.exports = {
  createReportServiceApiRouter
};
