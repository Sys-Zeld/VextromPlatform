const repository = require("../repositories/simpleRepository");
const { getProfileById } = require("../../../specflow/services/profiles");
const { getFieldById } = require("../../../specflow/services/fields");
const { resolveSelectionContext } = require("./specIntegrationService");
const { createHttpError } = require("../utils/errors");
const { ensureArray, toSafeString } = require("../utils/normalizers");

const VALID_OPERATORS = new Set(["equals", "contains", "gte", "lte"]);

function normalizeText(value) {
  return String(value === null || value === undefined ? "" : value).trim().toLowerCase();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).toLowerCase().replace(",", ".").replace(/[^0-9.\-]/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isEmptyValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function compareValues(operator, inputValue, variantValue) {
  if (operator === "contains") {
    return normalizeText(variantValue).includes(normalizeText(inputValue));
  }
  if (operator === "gte") {
    const left = normalizeNumber(variantValue);
    const right = normalizeNumber(inputValue);
    if (left === null || right === null) return false;
    return left >= right;
  }
  if (operator === "lte") {
    const left = normalizeNumber(variantValue);
    const right = normalizeNumber(inputValue);
    if (left === null || right === null) return false;
    return left <= right;
  }
  return normalizeText(variantValue) === normalizeText(inputValue);
}

function readVariantAttributeValue(attributes, key) {
  const attribute = ensureArray(attributes).find((item) => item.attributeKey === key);
  if (!attribute) return { exists: false, value: null, valueType: null };
  if (attribute.valueType === "number") return { exists: true, value: attribute.valueNumber, valueType: "number" };
  if (attribute.valueType === "boolean") return { exists: true, value: attribute.valueBoolean, valueType: "boolean" };
  if (attribute.valueType === "json") return { exists: true, value: attribute.valueJson, valueType: "json" };
  return { exists: true, value: attribute.valueText, valueType: "text" };
}

async function validateProfileExists(profileId) {
  const profile = await getProfileById(profileId);
  if (!profile) throw createHttpError(404, "Profile not found.");
  return profile;
}

async function validateFieldExists(fieldId) {
  const field = await getFieldById(fieldId);
  if (!field) throw createHttpError(422, `Field ${fieldId} not found.`);
  return field;
}

async function validateMappingsPayload(profileId, payload) {
  await validateProfileExists(profileId);
  const list = ensureArray(payload);
  const seen = new Set();
  const normalized = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index] || {};
    const fieldId = Number(item.fieldId || item.field_id);
    if (!Number.isInteger(fieldId) || fieldId <= 0) {
      throw createHttpError(422, `fieldId invalido na posicao ${index}.`);
    }
    await validateFieldExists(fieldId);
    const equipmentAttributeKey = toSafeString(item.equipmentAttributeKey || item.equipment_attribute_key);
    if (!equipmentAttributeKey) {
      throw createHttpError(422, `equipmentAttributeKey obrigatorio na posicao ${index}.`);
    }
    // Ensure mapping references a known attribute definition.
    // eslint-disable-next-line no-await-in-loop
    const attributeDefinition = await repository.getAttributeDefinitionByKey(equipmentAttributeKey);
    if (!attributeDefinition) {
      throw createHttpError(422, `Atributo '${equipmentAttributeKey}' nao encontrado na definicao de atributos.`);
    }
    const operator = toSafeString(item.operator || "equals").toLowerCase();
    if (!VALID_OPERATORS.has(operator)) {
      throw createHttpError(422, `operator invalido na posicao ${index}.`);
    }
    const dedupeKey = `${fieldId}:${equipmentAttributeKey}`;
    if (seen.has(dedupeKey)) {
      throw createHttpError(409, `Mapping duplicado para field ${fieldId} e atributo ${equipmentAttributeKey}.`);
    }
    seen.add(dedupeKey);
    normalized.push({
      fieldId,
      equipmentAttributeKey,
      operator,
      filterActive: item.filterActive !== false && item.filter_active !== false,
      requiredMatch: item.requiredMatch === true || item.required_match === true,
      sortOrder: Number(item.sortOrder || item.sort_order || index + 1)
    });
  }
  return normalized;
}

async function executeSimpleFilter({ profileId = null, equipmentId = null, required = {} }) {
  const context = await resolveSelectionContext({ profileId, equipmentId, required });
  await validateProfileExists(context.profileId);
  const mappings = await repository.listProfileFilterMappings(context.profileId);
  const activeMappings = mappings.filter((item) => item.filterActive);
  if (!activeMappings.length) {
    throw createHttpError(422, "Perfil sem filtros ativos configurados.");
  }
  const variants = await repository.listVariantsWithContext();
  const requiredSource = context.resolvedRequired || {};
  const appliedFilters = [];
  const ignoredFilters = [];

  activeMappings.forEach((mapping) => {
    const formValue = requiredSource[mapping.fieldKey];
    if (isEmptyValue(formValue)) {
      ignoredFilters.push({
        fieldId: mapping.fieldId,
        fieldKey: mapping.fieldKey,
        attributeKey: mapping.equipmentAttributeKey,
        reason: "empty_form_value"
      });
      return;
    }
    appliedFilters.push({
      fieldId: mapping.fieldId,
      fieldKey: mapping.fieldKey,
      operator: mapping.operator,
      attributeKey: mapping.equipmentAttributeKey,
      requiredMatch: mapping.requiredMatch,
      inputValue: formValue
    });
  });

  const matches = [];
  variants.forEach((variant) => {
    let compatible = true;
    const reasons = [];
    appliedFilters.forEach((filter) => {
      const variantAttr = readVariantAttributeValue(variant.attributes, filter.attributeKey);
      if (!variantAttr.exists) {
        if (filter.requiredMatch) {
          compatible = false;
          reasons.push(`Atributo ausente: ${filter.attributeKey}`);
        }
        return;
      }
      const ok = compareValues(filter.operator, filter.inputValue, variantAttr.value);
      if (!ok && filter.requiredMatch) {
        compatible = false;
        reasons.push(`Nao compativel: ${filter.fieldKey} (${filter.inputValue}) x ${filter.attributeKey} (${variantAttr.value})`);
      }
      if (ok) {
        reasons.push(`Compativel: ${filter.fieldKey} -> ${filter.attributeKey}`);
      }
    });
    if (compatible) {
      matches.push({
        variantId: variant.id,
        equipmentModelId: variant.equipmentModelId,
        manufacturer: variant.manufacturer,
        brand: variant.brand,
        model: variant.model,
        sku: variant.sku,
        variantName: variant.variantName,
        variantCode: variant.variantCode,
        reasons
      });
    }
  });

  return {
    profileId: context.profileId,
    equipmentId: context.sourceEquipmentId || null,
    appliedFilters,
    ignoredFilters,
    totalMatches: matches.length,
    matches
  };
}

module.exports = {
  VALID_OPERATORS,
  validateMappingsPayload,
  executeSimpleFilter
};

