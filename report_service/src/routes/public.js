const express = require("express");
const { createReportPublicController } = require("../controllers/createReportPublicController");

function createReportPublicRouter(deps) {
  const router = express.Router();
  const asyncHandler = deps.asyncHandler;
  const controller = createReportPublicController(deps);

  router.get("/sign/:token", asyncHandler(controller.clientSignPage));
  router.get("/sign/:token/report", asyncHandler(controller.clientSignedReportPage));
  router.get("/sign/:token/pdf", asyncHandler(controller.clientSignedReportPdf));
  router.get("/signed/:token", asyncHandler(controller.clientSignedReportPage));
  router.get("/signed/:token/pdf", asyncHandler(controller.clientSignedReportPdf));
  router.post(
    "/sign/:token/verify-email",
    express.urlencoded({ extended: false, limit: "1mb" }),
    asyncHandler(controller.clientVerifyEmail)
  );
  router.post(
    "/sign/:token",
    express.urlencoded({ extended: false, limit: "5mb" }),
    asyncHandler(controller.clientSubmitSign)
  );
  router.post(
    "/sign/:token/refuse",
    express.urlencoded({ extended: false, limit: "5mb" }),
    asyncHandler(controller.clientRefuseSign)
  );
  router.post(
    "/sign/:token/send-email",
    express.urlencoded({ extended: false, limit: "5mb" }),
    asyncHandler(controller.clientSendSignedEmail)
  );

  return router;
}

module.exports = { createReportPublicRouter };
