const { createHttpError } = require("../utils/errors");
const { getEquipmentById } = require("../../../specflow/services/equipments");
const { getEquipmentSpecification } = require("../../../specflow/services/specifications");

function flattenSpecification(specification) {
  const resolved = {};
  (specification.sections || []).forEach((section) => {
    (section.fields || []).forEach((field) => {
      resolved[field.key] = field.effectiveValue;
    });
  });
  return resolved;
}

async function resolveSelectionContext({ profileId = null, equipmentId = null, required = {} }) {
  if (equipmentId) {
    const equipment = await getEquipmentById(equipmentId);
    if (!equipment) {
      throw createHttpError(404, "Equipment not found.", null, "MODULE_SPEC_EQUIPMENT_NOT_FOUND");
    }
    const specification = await getEquipmentSpecification(equipment.id);
    return {
      profileId: profileId || equipment.profileId || null,
      sourceEquipmentId: equipment.id,
      sourceToken: equipment.token,
      resolvedRequired: flattenSpecification(specification)
    };
  }

  if (!profileId) {
    throw createHttpError(422, "profileId is required when equipmentId is not provided.");
  }

  return {
    profileId,
    sourceEquipmentId: null,
    sourceToken: null,
    resolvedRequired: required && typeof required === "object" ? required : {}
  };
}

module.exports = {
  resolveSelectionContext,
  flattenSpecification
};

