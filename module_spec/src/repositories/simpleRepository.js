const db = require("../../db");
const { getFieldById } = require("../../../specflow/services/fields");

function normalizeFamily(row) {
  return {
    id: Number(row.id),
    key: row.key,
    name: row.name,
    description: row.description || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeModel(row) {
  return {
    id: Number(row.id),
    familyId: row.family_id ? Number(row.family_id) : null,
    familyName: row.family_name || null,
    manufacturer: row.manufacturer || "",
    brand: row.brand || "",
    model: row.model || "",
    sku: row.sku || "",
    description: row.description || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeVariant(row) {
  return {
    id: Number(row.id),
    equipmentModelId: Number(row.equipment_model_id),
    variantName: row.variant_name || "",
    variantCode: row.variant_code || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeAttributeDefinition(row) {
  return {
    id: Number(row.id),
    key: row.key,
    label: row.label,
    dataType: row.data_type,
    unit: row.unit || "",
    allowedValuesJson: Array.isArray(row.allowed_values_json) ? row.allowed_values_json : [],
    description: row.description || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeVariantAttribute(row) {
  return {
    id: Number(row.id),
    equipmentVariantId: Number(row.equipment_variant_id),
    attributeKey: row.attribute_key,
    valueType: row.value_type,
    valueText: row.value_text,
    valueNumber: row.value_number === null || row.value_number === undefined ? null : Number(row.value_number),
    valueBoolean: row.value_boolean === null || row.value_boolean === undefined ? null : Boolean(row.value_boolean),
    valueJson: row.value_json,
    unit: row.unit || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeProfileFilterMapping(row) {
  return {
    id: Number(row.id),
    profileId: Number(row.profile_id),
    fieldId: Number(row.field_id),
    fieldKey: row.field_key || "",
    fieldLabel: row.field_label || "",
    equipmentAttributeKey: row.equipment_attribute_key,
    operator: row.operator,
    filterActive: Boolean(row.filter_active),
    requiredMatch: Boolean(row.required_match),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listFamilies() {
  const result = await db.query(`SELECT * FROM equipment_families ORDER BY name ASC, id ASC`);
  return result.rows.map(normalizeFamily);
}

async function getFamilyById(id) {
  const result = await db.query(`SELECT * FROM equipment_families WHERE id = $1`, [id]);
  return result.rows[0] ? normalizeFamily(result.rows[0]) : null;
}

async function createFamily(payload) {
  const result = await db.query(
    `INSERT INTO equipment_families (key, name, description, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
    [payload.key, payload.name, payload.description || "", payload.status || "active"]
  );
  return normalizeFamily(result.rows[0]);
}

async function updateFamily(id, payload) {
  const result = await db.query(
    `UPDATE equipment_families
     SET key = $2, name = $3, description = $4, status = $5, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, payload.key, payload.name, payload.description || "", payload.status || "active"]
  );
  return result.rows[0] ? normalizeFamily(result.rows[0]) : null;
}

async function deleteFamily(id) {
  const result = await db.query(`DELETE FROM equipment_families WHERE id = $1`, [id]);
  return result.rowCount > 0;
}

async function listModels() {
  const result = await db.query(
    `SELECT m.*, f.name AS family_name
     FROM equipment_models m
     LEFT JOIN equipment_families f ON f.id = m.family_id
     ORDER BY COALESCE(m.brand, ''), m.model, m.id`
  );
  return result.rows.map(normalizeModel);
}

async function getModelById(id) {
  const result = await db.query(
    `SELECT m.*, f.name AS family_name
     FROM equipment_models m
     LEFT JOIN equipment_families f ON f.id = m.family_id
     WHERE m.id = $1`,
    [id]
  );
  return result.rows[0] ? normalizeModel(result.rows[0]) : null;
}

async function createModel(payload) {
  const result = await db.query(
    `INSERT INTO equipment_models
      (family_id, manufacturer, brand, model, sku, description, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING *`,
    [
      payload.familyId,
      payload.manufacturer || "",
      payload.brand || "",
      payload.model || "",
      payload.sku || "",
      payload.description || "",
      payload.status || "active"
    ]
  );
  return getModelById(result.rows[0].id);
}

async function updateModel(id, payload) {
  const result = await db.query(
    `UPDATE equipment_models
     SET family_id = $2,
         manufacturer = $3,
         brand = $4,
         model = $5,
         sku = $6,
         description = $7,
         status = $8,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      payload.familyId,
      payload.manufacturer || "",
      payload.brand || "",
      payload.model || "",
      payload.sku || "",
      payload.description || "",
      payload.status || "active"
    ]
  );
  return result.rows[0] ? getModelById(id) : null;
}

async function deleteModel(id) {
  const result = await db.query(`DELETE FROM equipment_models WHERE id = $1`, [id]);
  return result.rowCount > 0;
}

async function listVariantsByModelId(modelId) {
  const result = await db.query(
    `SELECT * FROM equipment_variants WHERE equipment_model_id = $1 ORDER BY variant_name ASC, id ASC`,
    [modelId]
  );
  return result.rows.map(normalizeVariant);
}

async function getVariantById(id) {
  const result = await db.query(`SELECT * FROM equipment_variants WHERE id = $1`, [id]);
  return result.rows[0] ? normalizeVariant(result.rows[0]) : null;
}

async function createVariant(modelId, payload) {
  const result = await db.query(
    `INSERT INTO equipment_variants
      (equipment_model_id, variant_name, variant_code, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING *`,
    [modelId, payload.variantName, payload.variantCode || "", payload.status || "active"]
  );
  return normalizeVariant(result.rows[0]);
}

async function updateVariant(id, payload) {
  const result = await db.query(
    `UPDATE equipment_variants
     SET variant_name = $2, variant_code = $3, status = $4, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, payload.variantName, payload.variantCode || "", payload.status || "active"]
  );
  return result.rows[0] ? normalizeVariant(result.rows[0]) : null;
}

async function deleteVariant(id) {
  const result = await db.query(`DELETE FROM equipment_variants WHERE id = $1`, [id]);
  return result.rowCount > 0;
}

async function listAttributeDefinitions() {
  const result = await db.query(
    `SELECT * FROM equipment_attribute_definitions ORDER BY key ASC, id ASC`
  );
  return result.rows.map(normalizeAttributeDefinition);
}

async function getAttributeDefinitionById(id) {
  const result = await db.query(`SELECT * FROM equipment_attribute_definitions WHERE id = $1`, [id]);
  return result.rows[0] ? normalizeAttributeDefinition(result.rows[0]) : null;
}

async function getAttributeDefinitionByKey(key) {
  const result = await db.query(`SELECT * FROM equipment_attribute_definitions WHERE key = $1`, [key]);
  return result.rows[0] ? normalizeAttributeDefinition(result.rows[0]) : null;
}

async function createAttributeDefinition(payload) {
  const result = await db.query(
    `INSERT INTO equipment_attribute_definitions
      (key, label, data_type, unit, allowed_values_json, description, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW(), NOW())
     RETURNING *`,
    [
      payload.key,
      payload.label,
      payload.dataType,
      payload.unit || "",
      JSON.stringify(payload.allowedValuesJson || []),
      payload.description || "",
      payload.status || "active"
    ]
  );
  return normalizeAttributeDefinition(result.rows[0]);
}

async function updateAttributeDefinition(id, payload) {
  const result = await db.query(
    `UPDATE equipment_attribute_definitions
     SET key = $2, label = $3, data_type = $4, unit = $5, allowed_values_json = $6::jsonb,
         description = $7, status = $8, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [
      id,
      payload.key,
      payload.label,
      payload.dataType,
      payload.unit || "",
      JSON.stringify(payload.allowedValuesJson || []),
      payload.description || "",
      payload.status || "active"
    ]
  );
  return result.rows[0] ? normalizeAttributeDefinition(result.rows[0]) : null;
}

async function deleteAttributeDefinition(id) {
  const result = await db.query(`DELETE FROM equipment_attribute_definitions WHERE id = $1`, [id]);
  return result.rowCount > 0;
}

async function listVariantAttributes(variantId) {
  const result = await db.query(
    `SELECT * FROM equipment_variant_attributes WHERE equipment_variant_id = $1 ORDER BY attribute_key ASC, id ASC`,
    [variantId]
  );
  return result.rows.map(normalizeVariantAttribute);
}

async function replaceVariantAttributes(variantId, attributes) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM equipment_variant_attributes WHERE equipment_variant_id = $1`, [variantId]);
    for (const item of attributes) {
      await client.query(
        `INSERT INTO equipment_variant_attributes
          (equipment_variant_id, attribute_key, value_type, value_text, value_number, value_boolean, value_json, unit, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW(), NOW())`,
        [
          variantId,
          item.attributeKey,
          item.valueType,
          item.valueText || null,
          item.valueNumber ?? null,
          item.valueBoolean ?? null,
          item.valueJson ? JSON.stringify(item.valueJson) : null,
          item.unit || ""
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return listVariantAttributes(variantId);
}

async function listProfileFilterMappings(profileId) {
  const result = await db.query(
    `SELECT m.*
     FROM profile_filter_mappings m
     WHERE m.profile_id = $1
     ORDER BY m.sort_order ASC, m.id ASC`,
    [profileId]
  );
  const mappings = result.rows.map(normalizeProfileFilterMapping);
  const enriched = await Promise.all(
    mappings.map(async (mapping) => {
      const field = await getFieldById(mapping.fieldId);
      return {
        ...mapping,
        fieldKey: field?.key || "",
        fieldLabel: field?.label || ""
      };
    })
  );
  return enriched;
}

async function replaceProfileFilterMappings(profileId, mappings) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM profile_filter_mappings WHERE profile_id = $1`, [profileId]);
    for (const item of mappings) {
      await client.query(
        `INSERT INTO profile_filter_mappings
          (profile_id, field_id, equipment_attribute_key, operator, filter_active, required_match, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          profileId,
          item.fieldId,
          item.equipmentAttributeKey,
          item.operator,
          item.filterActive,
          item.requiredMatch,
          item.sortOrder
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return listProfileFilterMappings(profileId);
}

async function listVariantsWithContext() {
  const variantsResult = await db.query(
    `SELECT v.*, m.family_id, m.manufacturer, m.brand, m.model, m.sku, m.status AS model_status
     FROM equipment_variants v
     INNER JOIN equipment_models m ON m.id = v.equipment_model_id
     WHERE v.status = 'active' AND m.status = 'active'
     ORDER BY COALESCE(m.brand, ''), m.model, v.variant_name, v.id`
  );
  const variants = variantsResult.rows.map((row) => ({
    id: Number(row.id),
    equipmentModelId: Number(row.equipment_model_id),
    variantName: row.variant_name || "",
    variantCode: row.variant_code || "",
    manufacturer: row.manufacturer || "",
    brand: row.brand || "",
    model: row.model || "",
    sku: row.sku || "",
    familyId: row.family_id ? Number(row.family_id) : null
  }));
  if (!variants.length) return [];
  const attrsResult = await db.query(
    `SELECT * FROM equipment_variant_attributes WHERE equipment_variant_id = ANY($1::bigint[]) ORDER BY equipment_variant_id ASC, attribute_key ASC`,
    [variants.map((item) => item.id)]
  );
  const map = new Map();
  attrsResult.rows.map(normalizeVariantAttribute).forEach((item) => {
    if (!map.has(item.equipmentVariantId)) map.set(item.equipmentVariantId, []);
    map.get(item.equipmentVariantId).push(item);
  });
  return variants.map((item) => ({ ...item, attributes: map.get(item.id) || [] }));
}

module.exports = {
  listFamilies,
  getFamilyById,
  createFamily,
  updateFamily,
  deleteFamily,
  listModels,
  getModelById,
  createModel,
  updateModel,
  deleteModel,
  listVariantsByModelId,
  getVariantById,
  createVariant,
  updateVariant,
  deleteVariant,
  listAttributeDefinitions,
  getAttributeDefinitionById,
  getAttributeDefinitionByKey,
  createAttributeDefinition,
  updateAttributeDefinition,
  deleteAttributeDefinition,
  listVariantAttributes,
  replaceVariantAttributes,
  listProfileFilterMappings,
  replaceProfileFilterMappings,
  listVariantsWithContext
};

