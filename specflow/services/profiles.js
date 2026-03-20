const db = require("../db");
const {
  FIELD_TYPES,
  parseBooleanInput,
  validateTypedValue,
  createField,
  getFieldByKey
} = require("./fields");

function normalizeProfileRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    fieldsCount: Number(row.fields_count || 0),
    usageCount: Number(row.usage_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeBaseFieldRow(row) {
  return {
    fieldId: Number(row.field_id || row.id),
    key: row.key,
    label: row.label,
    section: row.section,
    fieldType: row.field_type,
    unit: row.unit || null,
    enumOptions: Array.isArray(row.enum_options) ? row.enum_options : null,
    hasDefault: row.has_default === null || row.has_default === undefined ? false : Boolean(row.has_default),
    defaultValue: row.default_value === undefined ? null : row.default_value,
    displayOrder: Number(row.display_order || 0),
    isEnabled: row.is_enabled === null || row.is_enabled === undefined ? true : Boolean(row.is_enabled),
    isRequired: row.is_required === null || row.is_required === undefined ? false : Boolean(row.is_required)
  };
}

function toSafeString(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function toSlug(value) {
  return toSafeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function normalizeFieldIds(fieldIds) {
  const list = Array.isArray(fieldIds) ? fieldIds : [];
  const unique = new Set();
  list.forEach((item) => {
    const id = Number(item);
    if (Number.isInteger(id) && id > 0) unique.add(id);
  });
  return Array.from(unique);
}

function normalizeProfileFieldsInput(fields) {
  return (Array.isArray(fields) ? fields : [])
    .map((f) => ({
      fieldId: Number(f.fieldId),
      isEnabled: parseBooleanInput(f.isEnabled) !== false,
      isRequired: parseBooleanInput(f.isRequired) === true,
      label: toSafeString(f.label),
      section: toSafeString(f.section),
      fieldType: toSafeString(f.fieldType).toLowerCase(),
      unit: toSafeString(f.unit) || null,
      enumOptions: Array.isArray(f.enumOptions) ? f.enumOptions.map((opt) => toSafeString(opt)).filter(Boolean) : null,
      hasDefault: parseBooleanInput(f.hasDefault) === true,
      defaultValue: f.defaultValue === undefined || f.defaultValue === "" ? null : f.defaultValue,
      displayOrder: Number(f.displayOrder || 0)
    }))
    .filter((f) => Number.isInteger(f.fieldId) && f.fieldId > 0);
}

function validateProfileFields(profileFields) {
  const errors = {};

  profileFields.forEach((field) => {
    if (!field.label) errors[`field_${field.fieldId}_label`] = "Label is required.";
    if (!field.section) errors[`field_${field.fieldId}_section`] = "Section is required.";
    if (!FIELD_TYPES.has(field.fieldType)) errors[`field_${field.fieldId}_fieldType`] = "Invalid field type.";

    if (field.fieldType === "enum" && (!Array.isArray(field.enumOptions) || !field.enumOptions.length)) {
      errors[`field_${field.fieldId}_enumOptions`] = "Enum options are required.";
    }

    if (field.hasDefault && !errors[`field_${field.fieldId}_fieldType`]) {
      try {
        validateTypedValue(
          { fieldType: field.fieldType, enumOptions: field.enumOptions || [] },
          field.defaultValue,
          false
        );
      } catch (err) {
        errors[`field_${field.fieldId}_defaultValue`] = err.message;
      }
    }
  });
  return errors;
}

async function listProfiles() {
  const result = await db.query(`
    SELECT p.*, COUNT(DISTINCT CASE WHEN pf.is_enabled THEN pf.field_id END)::int AS fields_count, COUNT(DISTINCT e.id)::int AS usage_count
    FROM field_profiles p
    LEFT JOIN field_profile_fields pf ON pf.profile_id = p.id
    LEFT JOIN equipments e ON e.profile_id = p.id
    GROUP BY p.id
    ORDER BY p.name ASC
  `);
  return result.rows.map(normalizeProfileRow);
}

async function getProfileById(id) {
  const result = await db.query("SELECT * FROM field_profiles WHERE id = $1", [id]);
  if (!result.rows[0]) return null;
  const profile = normalizeProfileRow({ ...result.rows[0], fields_count: 0, usage_count: 0 });
  const fields = await listProfileEditableFields(id);
  profile.fieldsCount = fields.filter((f) => f.isEnabled).length;
  return profile;
}

async function listBaseFields() {
  const result = await db.query(
    `
      SELECT id AS field_id, key, label, section, field_type, unit, enum_options, has_default, default_value, display_order, TRUE AS is_enabled
      , FALSE AS is_required
      FROM fields
      ORDER BY display_order ASC, id ASC
    `
  );
  return result.rows.map(normalizeBaseFieldRow);
}

async function listProfileEditableFields(profileId = null) {
  if (!profileId) {
    return listBaseFields();
  }

  const result = await db.query(
    `
      SELECT
        f.id AS field_id,
        f.key,
        COALESCE(pf.label, f.label) AS label,
        COALESCE(pf.section, f.section) AS section,
        COALESCE(pf.field_type, f.field_type) AS field_type,
        COALESCE(pf.unit, f.unit) AS unit,
        COALESCE(pf.enum_options, f.enum_options) AS enum_options,
        COALESCE(pf.has_default, f.has_default) AS has_default,
        COALESCE(pf.default_value, f.default_value) AS default_value,
        COALESCE(pf.display_order, f.display_order) AS display_order,
        COALESCE(pf.is_enabled, TRUE) AS is_enabled,
        COALESCE(pf.is_required, FALSE) AS is_required
      FROM field_profile_fields pf
      INNER JOIN fields f
        ON f.id = pf.field_id
      WHERE pf.profile_id = $1
      ORDER BY COALESCE(pf.display_order, f.display_order) ASC, f.id ASC
    `,
    [profileId]
  );
  return result.rows.map(normalizeBaseFieldRow);
}

async function getProfileFieldIds(profileId) {
  const fields = await listProfileEditableFields(profileId);
  return fields.filter((f) => f.isEnabled).map((f) => f.fieldId);
}

async function upsertProfileFields(client, profileId, profileFields) {
  await client.query("DELETE FROM field_profile_fields WHERE profile_id = $1", [profileId]);
  for (const field of profileFields) {
    await client.query(
      `
        INSERT INTO field_profile_fields
          (profile_id, field_id, is_enabled, is_required, label, section, field_type, unit, enum_options, has_default, default_value, display_order, created_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, NOW())
      `,
      [
        profileId,
        field.fieldId,
        Boolean(field.isEnabled),
        Boolean(field.isRequired),
        field.label,
        field.section,
        field.fieldType,
        field.unit,
        field.enumOptions ? JSON.stringify(field.enumOptions) : null,
        Boolean(field.hasDefault),
        field.hasDefault ? JSON.stringify(field.defaultValue) : null,
        Number(field.displayOrder || 0)
      ]
    );
  }
}

async function createProfile({ name, fieldIds = null, fields = null }) {
  const cleanName = toSafeString(name);
  const errors = {};
  if (!cleanName) errors.name = "Profile name is required.";

  let profileFields = [];
  if (Array.isArray(fields)) {
    profileFields = normalizeProfileFieldsInput(fields);
  } else {
    const selectedSet = new Set(normalizeFieldIds(fieldIds));
    const baseFields = await listBaseFields();
    profileFields = baseFields.map((field) => ({
      ...field,
      isEnabled: selectedSet.size ? selectedSet.has(field.fieldId) : true
    }));
  }

  const fieldErrors = validateProfileFields(profileFields);
  Object.assign(errors, fieldErrors);
  if (Object.keys(errors).length > 0) {
    const err = new Error("Validation failed.");
    err.statusCode = 422;
    err.details = errors;
    throw err;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      `
        INSERT INTO field_profiles (name, created_at, updated_at)
        VALUES ($1, NOW(), NOW())
        RETURNING *
      `,
      [cleanName]
    );
    const profile = normalizeProfileRow({ ...created.rows[0], fields_count: 0, usage_count: 0 });
    await upsertProfileFields(client, profile.id, profileFields);
    await client.query("COMMIT");
    profile.fieldsCount = profileFields.filter((f) => f.isEnabled).length;
    return profile;
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      const conflict = new Error("Profile name already exists.");
      conflict.statusCode = 409;
      conflict.details = { name: "Profile name already exists." };
      throw conflict;
    }
    throw err;
  } finally {
    client.release();
  }
}

async function updateProfile(id, { name, fieldIds = null, fields = null }) {
  const existing = await getProfileById(id);
  if (!existing) {
    const err = new Error("Profile not found.");
    err.statusCode = 404;
    throw err;
  }

  const cleanName = toSafeString(name);
  const errors = {};
  if (!cleanName) errors.name = "Profile name is required.";

  let profileFields = [];
  if (Array.isArray(fields)) {
    profileFields = normalizeProfileFieldsInput(fields);
  } else {
    const selectedSet = new Set(normalizeFieldIds(fieldIds));
    const baseFields = await listBaseFields();
    profileFields = baseFields.map((field) => ({
      ...field,
      isEnabled: selectedSet.size ? selectedSet.has(field.fieldId) : true
    }));
  }

  const fieldErrors = validateProfileFields(profileFields);
  Object.assign(errors, fieldErrors);
  if (Object.keys(errors).length > 0) {
    const err = new Error("Validation failed.");
    err.statusCode = 422;
    err.details = errors;
    throw err;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE field_profiles
        SET name = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [id, cleanName]
    );
    await upsertProfileFields(client, id, profileFields);
    await client.query("COMMIT");
    return {
      ...existing,
      name: cleanName,
      fieldsCount: profileFields.filter((f) => f.isEnabled).length
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      const conflict = new Error("Profile name already exists.");
      conflict.statusCode = 409;
      conflict.details = { name: "Profile name already exists." };
      throw conflict;
    }
    throw err;
  } finally {
    client.release();
  }
}

async function deleteProfile(id) {
  const result = await db.query("DELETE FROM field_profiles WHERE id = $1", [id]);
  return result.rowCount > 0;
}

async function buildUniqueFieldKey(baseKey) {
  let key = toSlug(baseKey) || "custom_field";
  let attempt = 0;
  while (attempt < 100) {
    // Avoid global key collision since fields.key is unique.
    // eslint-disable-next-line no-await-in-loop
    const existing = await getFieldByKey(key);
    if (!existing) return key;
    attempt += 1;
    key = `${toSlug(baseKey) || "custom_field"}_${attempt}`;
  }
  throw new Error("Could not generate unique field key.");
}

async function createFieldInProfile(profileId, payload) {
  const profile = await getProfileById(profileId);
  if (!profile) {
    const err = new Error("Profile not found.");
    err.statusCode = 404;
    throw err;
  }

  const section = toSafeString(payload.section) || "General";
  const label = toSafeString(payload.label);
  const requestedKey = toSafeString(payload.key) || label;
  const key = await buildUniqueFieldKey(requestedKey);
  const enumOptions = Array.isArray(payload.enumOptions)
    ? payload.enumOptions.map((item) => toSafeString(item)).filter(Boolean)
    : [];
  const hasDefault = parseBooleanInput(payload.hasDefault) === true;
  const isRequired = parseBooleanInput(payload.isRequired) === true;

  const existingFields = await listProfileEditableFields(profileId);
  const nextOrder = existingFields
    .filter((item) => toSafeString(item.section) === section)
    .reduce((max, item) => Math.max(max, Number(item.displayOrder || 0)), 0) + 1;

  const createdField = await createField({
    key,
    label,
    section,
    fieldType: toSafeString(payload.fieldType || "text"),
    unit: toSafeString(payload.unit) || null,
    enumOptions,
    hasDefault,
    defaultValue: hasDefault ? payload.defaultValue : null,
    displayOrder: nextOrder
  });

  await db.query(
    `
      INSERT INTO field_profile_fields
        (profile_id, field_id, is_enabled, is_required, label, section, field_type, unit, enum_options, has_default, default_value, display_order, created_at)
      VALUES
        ($1, $2, TRUE, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, NOW())
      ON CONFLICT (profile_id, field_id)
      DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        is_required = EXCLUDED.is_required,
        label = EXCLUDED.label,
        section = EXCLUDED.section,
        field_type = EXCLUDED.field_type,
        unit = EXCLUDED.unit,
        enum_options = EXCLUDED.enum_options,
        has_default = EXCLUDED.has_default,
        default_value = EXCLUDED.default_value,
        display_order = EXCLUDED.display_order
    `,
    [
      profileId,
      createdField.id,
      Boolean(isRequired),
      createdField.label,
      createdField.section,
      createdField.fieldType,
      createdField.unit || null,
      createdField.enumOptions ? JSON.stringify(createdField.enumOptions) : null,
      Boolean(createdField.hasDefault),
      createdField.hasDefault ? JSON.stringify(createdField.defaultValue) : null,
      Number(createdField.displayOrder || nextOrder)
    ]
  );

  return createdField;
}

async function deleteFieldFromProfile(profileId, fieldId) {
  const result = await db.query(
    "DELETE FROM field_profile_fields WHERE profile_id = $1 AND field_id = $2",
    [profileId, fieldId]
  );
  return result.rowCount > 0;
}

async function clearSectionFromProfile(profileId, sectionName) {
  const cleanSection = toSafeString(sectionName);
  if (!cleanSection) return 0;
  const result = await db.query(
    `
      DELETE FROM field_profile_fields pf
      USING fields f
      WHERE pf.profile_id = $1
        AND pf.field_id = f.id
        AND LOWER(TRIM(COALESCE(pf.section, f.section))) = LOWER(TRIM($2))
    `,
    [profileId, cleanSection]
  );
  return result.rowCount;
}

async function clearAllFieldsFromProfile(profileId) {
  const result = await db.query(
    "DELETE FROM field_profile_fields WHERE profile_id = $1",
    [profileId]
  );
  return result.rowCount;
}

async function listProfileFieldsForSpecification(profileId) {
  const fields = await listProfileEditableFields(profileId);
  return fields
    .filter((field) => field.isEnabled)
    .map((field) => ({
      id: field.fieldId,
      key: field.key,
      label: field.label,
      section: field.section,
      fieldType: field.fieldType,
      unit: field.unit || null,
      enumOptions: field.enumOptions || null,
      isRequired: Boolean(field.isRequired),
      hasDefault: Boolean(field.hasDefault),
      defaultValue: field.defaultValue === undefined ? null : field.defaultValue,
      displayOrder: Number(field.displayOrder || 0)
    }));
}

module.exports = {
  listProfiles,
  getProfileById,
  listBaseFields,
  listProfileEditableFields,
  listProfileFieldsForSpecification,
  getProfileFieldIds,
  createProfile,
  updateProfile,
  deleteProfile,
  createFieldInProfile,
  deleteFieldFromProfile,
  clearSectionFromProfile,
  clearAllFieldsFromProfile
};
