const express = require("express");
const { createModuleSpecController } = require("../controllers/createModuleSpecController");

function createModuleSpecRouter(deps) {
  const router = express.Router();
  const controller = createModuleSpecController();
  const asyncHandler = deps.asyncHandler;
  const readAccess = deps.requireApiScope("module-spec:read");
  const writeAccess = deps.requireApiScope("module-spec:write");
  const executeAccess = deps.requireApiScope("module-spec:execute");

  router.get("/families", readAccess, asyncHandler(controller.listFamilies));
  router.post("/families", writeAccess, asyncHandler(controller.createFamily));
  router.get("/families/:id", readAccess, asyncHandler(controller.getFamily));
  router.put("/families/:id", writeAccess, asyncHandler(controller.updateFamily));
  router.delete("/families/:id", writeAccess, asyncHandler(controller.deleteFamily));

  router.get("/models", readAccess, asyncHandler(controller.listModels));
  router.post("/models", writeAccess, asyncHandler(controller.createModel));
  router.get("/models/:id", readAccess, asyncHandler(controller.getModel));
  router.put("/models/:id", writeAccess, asyncHandler(controller.updateModel));
  router.delete("/models/:id", writeAccess, asyncHandler(controller.deleteModel));

  router.get("/models/:id/variants", readAccess, asyncHandler(controller.listVariantsByModel));
  router.post("/models/:id/variants", writeAccess, asyncHandler(controller.createVariantForModel));
  router.get("/variants/:id", readAccess, asyncHandler(controller.getVariant));
  router.put("/variants/:id", writeAccess, asyncHandler(controller.updateVariant));
  router.delete("/variants/:id", writeAccess, asyncHandler(controller.deleteVariant));

  router.get("/attributes/definitions", readAccess, asyncHandler(controller.listAttributeDefinitions));
  router.post("/attributes/definitions", writeAccess, asyncHandler(controller.createAttributeDefinition));
  router.get("/attributes/definitions/:id", readAccess, asyncHandler(controller.getAttributeDefinition));
  router.put("/attributes/definitions/:id", writeAccess, asyncHandler(controller.updateAttributeDefinition));
  router.delete("/attributes/definitions/:id", writeAccess, asyncHandler(controller.deleteAttributeDefinition));

  router.get("/variants/:id/attributes", readAccess, asyncHandler(controller.listVariantAttributes));
  router.put("/variants/:id/attributes", writeAccess, asyncHandler(controller.replaceVariantAttributes));

  router.get("/profiles/:profileId/filter-mappings", readAccess, asyncHandler(controller.listProfileFilterMappings));
  router.put("/profiles/:profileId/filter-mappings", writeAccess, asyncHandler(controller.replaceProfileFilterMappings));

  router.post("/profiles/:profileId/filter", executeAccess, asyncHandler(controller.runFilterByProfile));
  router.post("/equipments/:equipmentId/filter", executeAccess, asyncHandler(controller.runFilterByEquipment));

  return router;
}

module.exports = {
  createModuleSpecRouter
};
