const db = require("../db");
const { listFields, getFieldById, validateTypedValue } = require("./fields");
const { getEnabledFieldIdsForEquipment, getEquipmentById } = require("./equipments");
const { listProfileFieldsForSpecification } = require("./profiles");

function normalizeValueRow(row) {
  return {
    id: Number(row.id),
    equipmentId: Number(row.equipment_id),
    fieldId: Number(row.field_id),
    value: row.value,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function groupFieldsBySection(fields) {
  return fields.reduce((acc, field) => {
    if (!acc[field.section]) {
      acc[field.section] = [];
    }
    acc[field.section].push(field);
    return acc;
  }, {});
}

async function getSavedValuesByEquipment(equipmentId) {
  const result = await db.query(
    "SELECT id, equipment_id, field_id, value, created_at, updated_at FROM equipment_field_values WHERE equipment_id = $1",
    [equipmentId]
  );
  const map = {};
  result.rows.forEach((row) => {
    const normalized = normalizeValueRow(row);
    map[normalized.fieldId] = normalized;
  });
  return map;
}

function resolveEffectiveValue(field, savedValueMap) {
  const saved = savedValueMap[field.id];
  if (saved) {
    return { value: saved.value, source: "saved" };
  }
  if (field.hasDefault) {
    return { value: field.defaultValue, source: "default" };
  }
  return { value: null, source: "empty" };
}

async function getEquipmentSpecification(equipmentId, section = null, lang = "en") {
  const equipment = await getEquipmentById(equipmentId);
  const fields = equipment && equipment.profileId
    ? await listProfileFieldsForSpecification(equipment.profileId)
    : await listFields(section ? { section, lang } : { lang });
  const enabledFieldIds = await getEnabledFieldIdsForEquipment(equipmentId);
  const effectiveFields = enabledFieldIds.length
    ? fields.filter((field) => enabledFieldIds.includes(field.id))
    : fields;
  const savedMap = await getSavedValuesByEquipment(equipmentId);
  const grouped = groupFieldsBySection(effectiveFields);

  const sections = Object.entries(grouped).map(([sectionName, sectionFields]) => ({
    section: sectionName,
    fields: sectionFields.map((field) => {
      const effective = resolveEffectiveValue(field, savedMap);
      return {
        ...field,
        effectiveValue: effective.value,
        valueSource: effective.source
      };
    })
  }));

  return {
    equipmentId: Number(equipmentId),
    sections
  };
}

async function saveEquipmentSpecification(equipmentId, payloadValues) {
  const values = payloadValues || {};
  const keys = Object.keys(values);
  if (!keys.length) {
    return { updated: 0 };
  }

  const client = await db.connect();
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const fieldIdText of keys) {
      const fieldId = Number(fieldIdText);
      if (!Number.isInteger(fieldId) || fieldId <= 0) continue;
      const field = await getFieldById(fieldId);
      if (!field) {
        const err = new Error(`Field ${fieldId} not found.`);
        err.statusCode = 404;
        throw err;
      }

      let normalized;
      try {
        normalized = validateTypedValue(field, values[fieldIdText], true);
      } catch (err) {
        const validationError = new Error(`Field ${field.key}: ${err.message}`);
        validationError.statusCode = 422;
        throw validationError;
      }

      if (!normalized.hasValue) {
        await client.query(
          "DELETE FROM equipment_field_values WHERE equipment_id = $1 AND field_id = $2",
          [equipmentId, fieldId]
        );
        updated += 1;
        continue;
      }

      await client.query(
        `
          INSERT INTO equipment_field_values (equipment_id, field_id, value, created_at, updated_at)
          VALUES ($1, $2, $3::jsonb, NOW(), NOW())
          ON CONFLICT (equipment_id, field_id)
          DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `,
        [equipmentId, fieldId, JSON.stringify(normalized.value)]
      );
      updated += 1;
    }
    await client.query("UPDATE equipments SET updated_at = NOW() WHERE id = $1", [equipmentId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { updated };
}

module.exports = {
  getEquipmentSpecification,
  saveEquipmentSpecification
};
