const express = require("express");
const { createReportWebController } = require("../controllers/createReportWebController");

function createReportServiceWebRouter(deps) {
  const router = express.Router();
  const asyncHandler = deps.asyncHandler;
  const controller = createReportWebController(deps);

  router.get("/", deps.requireAdminAuth, asyncHandler(controller.home));
  router.get("/orders", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.listOrders));
  router.post("/orders", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createOrder));
  router.post("/orders/:id/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteOrder));
  router.get("/orders/:id", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.orderEditor));
  router.post("/orders/:id/equipments", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.attachEquipment));
  router.post("/orders/:id/timesheet", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addTimesheet));
  router.post("/orders/:id/daily-logs", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addDailyLog));
  router.post("/orders/:id/sections", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createSection));
  router.post("/orders/:id/sections/:sectionKey", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.saveSection));
  router.post("/orders/:id/sections/:sectionKey/delete", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.deleteSection));
  router.post("/orders/:id/components", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addComponent));
  router.post("/orders/:id/signatures", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addSignature));
  router.post("/orders/:id/technicians", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.addTechnician));
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
  router.get("/orders/:id/pdf-preview", deps.requireAdminAuth, asyncHandler(controller.pdfPreview));
  router.post("/orders/:id/generate-pdf", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.generatePdf));
  router.get("/reports/:id/editor", deps.requireAdminAuth, asyncHandler(controller.reportEditor));
  router.get("/reports/:id/preview", deps.requireAdminAuth, asyncHandler(controller.reportPreview));
  router.post("/reports/:id/generate-pdf", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.reportGeneratePdf));

  router.get("/customers", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.listCustomers));
  router.post("/customers", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createCustomer));
  router.post("/sites", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createSite));

  router.get("/equipments", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.listEquipments));
  router.post("/equipments", deps.csrfProtection, deps.requireAdminAuth, asyncHandler(controller.createEquipment));

  return router;
}

module.exports = {
  createReportServiceWebRouter
};
