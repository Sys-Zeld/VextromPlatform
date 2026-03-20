const repository = require("../repositories/simpleRepository");
const { validateMappingsPayload, executeSimpleFilter } = require("../services/simpleFilterService");
const { resolveSelectionContext } = require("../services/specIntegrationService");
const { createHttpError } = require("../utils/errors");
const { ensureArray, parseJsonArray, toSafeString } = require("../utils/normalizers");
const { getProfileById } = require("../../../specflow/services/profiles");

function toPayload(req) {
  return req.body || {};
}

function normalizeAttributesInput(body) {
  const source = Array.isArray(body) ? body : body.attributes;
  return ensureArray(source).map((item) => ({
    attributeKey: toSafeString(item.attributeKey || item.attribute_key),
    valueType: toSafeString(item.valueType || item.value_type).toLowerCase() || "text",
    valueText: item.valueText || item.value_text || null,
    valueNumber: item.valueNumber !== undefined ? Number(item.valueNumber) : (item.value_number !== undefined ? Number(item.value_number) : null),
    valueBoolean: item.valueBoolean !== undefined ? Boolean(item.valueBoolean) : (item.value_boolean !== undefined ? Boolean(item.value_boolean) : null),
    valueJson: item.valueJson || item.value_json || null,
    unit: toSafeString(item.unit)
  }));
}

function createModuleSpecController() {
  return {
    listFamilies: async (_req, res) => res.json({ data: await repository.listFamilies() }),
    createFamily: async (req, res) => {
      const payload = toPayload(req);
      const created = await repository.createFamily({
        key: toSafeString(payload.key).toLowerCase(),
        name: toSafeString(payload.name),
        description: toSafeString(payload.description),
        status: toSafeString(payload.status) || "active"
      });
      res.status(201).json({ data: created });
    },
    getFamily: async (req, res) => {
      const entity = await repository.getFamilyById(Number(req.params.id));
      if (!entity) throw createHttpError(404, "Family not found.");
      res.json({ data: entity });
    },
    updateFamily: async (req, res) => {
      const payload = toPayload(req);
      const updated = await repository.updateFamily(Number(req.params.id), {
        key: toSafeString(payload.key).toLowerCase(),
        name: toSafeString(payload.name),
        description: toSafeString(payload.description),
        status: toSafeString(payload.status) || "active"
      });
      if (!updated) throw createHttpError(404, "Family not found.");
      res.json({ data: updated });
    },
    deleteFamily: async (req, res) => {
      const deleted = await repository.deleteFamily(Number(req.params.id));
      if (!deleted) throw createHttpError(404, "Family not found.");
      res.json({ data: { deleted: true } });
    },
    listModels: async (_req, res) => res.json({ data: await repository.listModels() }),
    createModel: async (req, res) => {
      const payload = toPayload(req);
      const familyId = Number(payload.familyId || payload.family_id);
      const family = await repository.getFamilyById(familyId);
      if (!family) throw createHttpError(422, "family_id invalido.");
      const created = await repository.createModel({
        familyId,
        manufacturer: toSafeString(payload.manufacturer),
        brand: toSafeString(payload.brand),
        model: toSafeString(payload.model),
        sku: toSafeString(payload.sku),
        description: toSafeString(payload.description),
        status: toSafeString(payload.status) || "active"
      });
      res.status(201).json({ data: created });
    },
    getModel: async (req, res) => {
      const entity = await repository.getModelById(Number(req.params.id));
      if (!entity) throw createHttpError(404, "Model not found.");
      res.json({ data: entity });
    },
    updateModel: async (req, res) => {
      const payload = toPayload(req);
      const familyId = Number(payload.familyId || payload.family_id);
      const family = await repository.getFamilyById(familyId);
      if (!family) throw createHttpError(422, "family_id invalido.");
      const updated = await repository.updateModel(Number(req.params.id), {
        familyId,
        manufacturer: toSafeString(payload.manufacturer),
        brand: toSafeString(payload.brand),
        model: toSafeString(payload.model),
        sku: toSafeString(payload.sku),
        description: toSafeString(payload.description),
        status: toSafeString(payload.status) || "active"
      });
      if (!updated) throw createHttpError(404, "Model not found.");
      res.json({ data: updated });
    },
    deleteModel: async (req, res) => {
      const deleted = await repository.deleteModel(Number(req.params.id));
      if (!deleted) throw createHttpError(404, "Model not found.");
      res.json({ data: { deleted: true } });
    },
    listVariantsByModel: async (req, res) => {
      res.json({ data: await repository.listVariantsByModelId(Number(req.params.id)) });
    },
    createVariantForModel: async (req, res) => {
      const payload = toPayload(req);
      const modelId = Number(req.params.id);
      const model = await repository.getModelById(modelId);
      if (!model) throw createHttpError(422, "Model not found.");
      const created = await repository.createVariant(modelId, {
        variantName: toSafeString(payload.variantName || payload.variant_name),
        variantCode: toSafeString(payload.variantCode || payload.variant_code),
        status: toSafeString(payload.status) || "active"
      });
      res.status(201).json({ data: created });
    },
    getVariant: async (req, res) => {
      const entity = await repository.getVariantById(Number(req.params.id));
      if (!entity) throw createHttpError(404, "Variant not found.");
      res.json({ data: entity });
    },
    updateVariant: async (req, res) => {
      const payload = toPayload(req);
      const updated = await repository.updateVariant(Number(req.params.id), {
        variantName: toSafeString(payload.variantName || payload.variant_name),
        variantCode: toSafeString(payload.variantCode || payload.variant_code),
        status: toSafeString(payload.status) || "active"
      });
      if (!updated) throw createHttpError(404, "Variant not found.");
      res.json({ data: updated });
    },
    deleteVariant: async (req, res) => {
      const deleted = await repository.deleteVariant(Number(req.params.id));
      if (!deleted) throw createHttpError(404, "Variant not found.");
      res.json({ data: { deleted: true } });
    },
    listAttributeDefinitions: async (_req, res) => res.json({ data: await repository.listAttributeDefinitions() }),
    createAttributeDefinition: async (req, res) => {
      const payload = toPayload(req);
      const created = await repository.createAttributeDefinition({
        key: toSafeString(payload.key).toLowerCase(),
        label: toSafeString(payload.label),
        dataType: toSafeString(payload.dataType || payload.data_type).toLowerCase() || "text",
        unit: toSafeString(payload.unit),
        allowedValuesJson: parseJsonArray(payload.allowedValuesJson || payload.allowed_values_json || []),
        description: toSafeString(payload.description),
        status: toSafeString(payload.status) || "active"
      });
      res.status(201).json({ data: created });
    },
    getAttributeDefinition: async (req, res) => {
      const entity = await repository.getAttributeDefinitionById(Number(req.params.id));
      if (!entity) throw createHttpError(404, "Attribute definition not found.");
      res.json({ data: entity });
    },
    updateAttributeDefinition: async (req, res) => {
      const payload = toPayload(req);
      const updated = await repository.updateAttributeDefinition(Number(req.params.id), {
        key: toSafeString(payload.key).toLowerCase(),
        label: toSafeString(payload.label),
        dataType: toSafeString(payload.dataType || payload.data_type).toLowerCase() || "text",
        unit: toSafeString(payload.unit),
        allowedValuesJson: parseJsonArray(payload.allowedValuesJson || payload.allowed_values_json || []),
        description: toSafeString(payload.description),
        status: toSafeString(payload.status) || "active"
      });
      if (!updated) throw createHttpError(404, "Attribute definition not found.");
      res.json({ data: updated });
    },
    deleteAttributeDefinition: async (req, res) => {
      const deleted = await repository.deleteAttributeDefinition(Number(req.params.id));
      if (!deleted) throw createHttpError(404, "Attribute definition not found.");
      res.json({ data: { deleted: true } });
    },
    listVariantAttributes: async (req, res) => {
      res.json({ data: await repository.listVariantAttributes(Number(req.params.id)) });
    },
    replaceVariantAttributes: async (req, res) => {
      const variantId = Number(req.params.id);
      const variant = await repository.getVariantById(variantId);
      if (!variant) throw createHttpError(404, "Variant not found.");
      const updated = await repository.replaceVariantAttributes(variantId, normalizeAttributesInput(req.body));
      res.json({ data: updated });
    },
    listProfileFilterMappings: async (req, res) => {
      const profileId = Number(req.params.profileId);
      const profile = await getProfileById(profileId);
      if (!profile) throw createHttpError(404, "Profile not found.");
      res.json({ data: await repository.listProfileFilterMappings(profileId) });
    },
    replaceProfileFilterMappings: async (req, res) => {
      const profileId = Number(req.params.profileId);
      const mappings = await validateMappingsPayload(profileId, req.body.mappings || req.body);
      const updated = await repository.replaceProfileFilterMappings(profileId, mappings);
      res.json({ data: updated });
    },
    runFilterByProfile: async (req, res) => {
      const profileId = Number(req.params.profileId);
      const result = await executeSimpleFilter({
        profileId,
        required: req.body.required || req.body.resolvedRequiredJson || {}
      });
      res.json({ data: result });
    },
    runFilterByEquipment: async (req, res) => {
      const equipmentId = Number(req.params.equipmentId);
      const context = await resolveSelectionContext({ equipmentId });
      const result = await executeSimpleFilter({
        profileId: context.profileId,
        equipmentId,
        required: context.resolvedRequired
      });
      res.json({ data: result });
    }
  };
}

module.exports = {
  createModuleSpecController
};

