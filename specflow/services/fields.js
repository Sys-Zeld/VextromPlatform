const db = require("../db");
const { SECTION_ORDER, getSectionLabel, getFieldLabel } = require("../schema/annexD.fields.seed");

const FIELD_TYPES = new Set(["text", "number", "enum", "boolean", "time", "dimension"]);

function normalizeFieldType(type) {
  return String(type || "").trim().toLowerCase();
}

function toSafeString(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseOptionalJsonArray(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string" && input.trim()) {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_err) {
      return null;
    }
  }
  return null;
}

function parseBooleanInput(value) {
  if (typeof value === "boolean") return value;
  const raw = toSafeString(value).toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return null;
}

function parseDefaultValueInput(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return raw;
    }
  }
  return value;
}

function normalizeFieldRow(row, lang = "en") {
  return {
    id: Number(row.id),
    key: row.key,
    label: getFieldLabel(row.key, row.label, lang),
    section: getSectionLabel(row.section, lang),
    sectionKey: row.section,
    fieldType: row.field_type,
    unit: row.unit || null,
    enumOptions: row.enum_options || null,
    hasDefault: Boolean(row.has_default),
    defaultValue: row.default_value === undefined ? null : row.default_value,
    displayOrder: Number(row.display_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateTypedValue(field, rawValue, allowEmpty = true) {
  const fieldType = normalizeFieldType(field.fieldType || field.field_type);
  if (!FIELD_TYPES.has(fieldType)) {
    throw new Error("Unsupported field type.");
  }

  if (rawValue === undefined || rawValue === null || rawValue === "") {
    if (allowEmpty) {
      return { hasValue: false, value: null };
    }
    throw new Error("Value is required.");
  }

  if (fieldType === "text") {
    return { hasValue: true, value: String(rawValue).trim() };
  }

  if (fieldType === "number") {
    const numeric = typeof rawValue === "number" ? rawValue : Number(String(rawValue).replace(",", "."));
    if (!Number.isFinite(numeric)) {
      throw new Error("Invalid number.");
    }
    return { hasValue: true, value: numeric };
  }

  if (fieldType === "boolean") {
    if (typeof rawValue === "boolean") {
      return { hasValue: true, value: rawValue };
    }
    const parsed = parseBooleanInput(rawValue);
    if (parsed === null) {
      throw new Error("Invalid boolean.");
    }
    return { hasValue: true, value: parsed };
  }

  if (fieldType === "enum") {
    const selected = String(rawValue).trim();
    const options = Array.isArray(field.enumOptions || field.enum_options) ? (field.enumOptions || field.enum_options) : [];
    if (!options.includes(selected)) {
      throw new Error("Invalid enum option.");
    }
    return { hasValue: true, value: selected };
  }

  if (fieldType === "time") {
    const normalized = String(rawValue).trim();
    if (!/^\d{2}:\d{2}$/.test(normalized)) {
      throw new Error("Invalid time. Use hh:mm.");
    }
    return { hasValue: true, value: normalized };
  }

  if (fieldType === "dimension") {
    const normalized = String(rawValue).trim();
    if (!/^\d+(\.\d+)?\s*x\s*\d+(\.\d+)?\s*x\s*\d+(\.\d+)?$/i.test(normalized)) {
      throw new Error("Invalid dimension. Use HxWxD.");
    }
    return { hasValue: true, value: normalized.replace(/\s+/g, "") };
  }

  throw new Error("Unsupported field type.");
}

function validateFieldPayload(payload, options = {}) {
  const partial = Boolean(options.partial);
  const errors = {};

  const key = toSafeString(payload.key);
  const label = toSafeString(payload.label);
  const section = toSafeString(payload.section);
  const fieldType = normalizeFieldType(payload.fieldType);
  const unit = toSafeString(payload.unit);
  const hasDefaultParsed = parseBooleanInput(payload.hasDefault);
  const hasDefault = hasDefaultParsed === null ? false : hasDefaultParsed;
  const enumOptionsRaw = parseOptionalJsonArray(payload.enumOptions);
  const defaultValueRaw = parseDefaultValueInput(payload.defaultValue);

  if (!partial || payload.key !== undefined) {
    if (!key) errors.key = "Key is required.";
    if (key && !/^[a-z0-9_]+$/.test(key)) errors.key = "Key must be a slug with lowercase letters, numbers and underscore.";
  }

  if (!partial || payload.label !== undefined) {
    if (!label) errors.label = "Label is required.";
  }

  if (!partial || payload.section !== undefined) {
    if (!section) errors.section = "Section is required.";
  }

  if (!partial || payload.fieldType !== undefined) {
    if (!FIELD_TYPES.has(fieldType)) errors.fieldType = "Invalid fieldType.";
  }

  let enumOptions = null;
  if (fieldType === "enum" || (!partial && payload.fieldType === "enum")) {
    enumOptions = enumOptionsRaw;
    if (!Array.isArray(enumOptions) || !enumOptions.length) {
      errors.enumOptions = "Enum field requires enumOptions.";
    } else {
      const clean = enumOptions.map((opt) => toSafeString(opt)).filter(Boolean);
      if (clean.length !== enumOptions.length) {
        errors.enumOptions = "Enum options must be non-empty strings.";
      }
      enumOptions = clean;
    }
  } else {
    enumOptions = Array.isArray(enumOptionsRaw) ? enumOptionsRaw : null;
  }

  let defaultValue = null;
  if (hasDefault) {
    if (defaultValueRaw === null) {
      errors.defaultValue = "defaultValue is required when hasDefault is true.";
    } else if (!errors.fieldType) {
      try {
        const typed = validateTypedValue(
          { fieldType, enumOptions },
          defaultValueRaw,
          false
        );
        defaultValue = typed.value;
      } catch (err) {
        errors.defaultValue = err.message;
      }
    }
  }

  return {
    errors,
    value: {
      key,
      label,
      section,
      fieldType,
      unit: unit || null,
      enumOptions,
      hasDefault,
      defaultValue: hasDefault ? defaultValue : null
    }
  };
}

async function listFields(filters = {}) {
  const lang = String(filters.lang || "en").toLowerCase().startsWith("pt") ? "pt" : "en";
  const where = [];
  const values = [];
  if (filters.section) {
    values.push(filters.section);
    where.push(`section = $${values.length}`);
  }
  const sql = `
    SELECT *
    FROM fields
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY
      CASE ${SECTION_ORDER.map((name, idx) => `WHEN section = '${name.replace(/'/g, "''")}' THEN ${idx}`).join(" ")} ELSE 999 END,
      display_order ASC,
      id ASC
  `;
  const result = await db.query(sql, values);
  return result.rows.map((row) => normalizeFieldRow(row, lang));
}

async function getFieldById(id) {
  const result = await db.query("SELECT * FROM fields WHERE id = $1", [id]);
  return result.rows[0] ? normalizeFieldRow(result.rows[0]) : null;
}

async function getFieldByKey(key) {
  const result = await db.query("SELECT * FROM fields WHERE key = $1", [key]);
  return result.rows[0] ? normalizeFieldRow(result.rows[0]) : null;
}

async function createField(payload) {
  const { errors, value } = validateFieldPayload(payload);
  if (Object.keys(errors).length > 0) {
    const err = new Error("Validation failed.");
    err.statusCode = 422;
    err.details = errors;
    throw err;
  }

  const result = await db.query(
    `
      INSERT INTO fields (key, label, section, field_type, unit, enum_options, has_default, default_value, display_order, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, NOW(), NOW())
      RETURNING *
    `,
    [
      value.key,
      value.label,
      value.section,
      value.fieldType,
      value.unit,
      value.enumOptions ? JSON.stringify(value.enumOptions) : null,
      value.hasDefault,
      value.hasDefault ? JSON.stringify(value.defaultValue) : null,
      Number(payload.displayOrder || 0)
    ]
  );
  return normalizeFieldRow(result.rows[0]);
}

async function updateField(id, payload) {
  const existing = await getFieldById(id);
  if (!existing) {
    const err = new Error("Field not found.");
    err.statusCode = 404;
    throw err;
  }

  const merged = {
    key: payload.key !== undefined ? payload.key : existing.key,
    label: payload.label !== undefined ? payload.label : existing.label,
    section: payload.section !== undefined ? payload.section : existing.section,
    fieldType: payload.fieldType !== undefined ? payload.fieldType : existing.fieldType,
    unit: payload.unit !== undefined ? payload.unit : existing.unit,
    enumOptions: payload.enumOptions !== undefined ? payload.enumOptions : existing.enumOptions,
    hasDefault: payload.hasDefault !== undefined ? payload.hasDefault : existing.hasDefault,
    defaultValue: payload.defaultValue !== undefined ? payload.defaultValue : existing.defaultValue
  };

  const { errors, value } = validateFieldPayload(merged);
  if (Object.keys(errors).length > 0) {
    const err = new Error("Validation failed.");
    err.statusCode = 422;
    err.details = errors;
    throw err;
  }

  const displayOrder = payload.displayOrder !== undefined ? Number(payload.displayOrder || 0) : existing.displayOrder;
  const result = await db.query(
    `
      UPDATE fields
      SET key = $2,
          label = $3,
          section = $4,
          field_type = $5,
          unit = $6,
          enum_options = $7::jsonb,
          has_default = $8,
          default_value = $9::jsonb,
          display_order = $10,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      value.key,
      value.label,
      value.section,
      value.fieldType,
      value.unit,
      value.enumOptions ? JSON.stringify(value.enumOptions) : null,
      value.hasDefault,
      value.hasDefault ? JSON.stringify(value.defaultValue) : null,
      displayOrder
    ]
  );
  return normalizeFieldRow(result.rows[0]);
}

async function deleteField(id) {
  const result = await db.query("DELETE FROM fields WHERE id = $1", [id]);
  return result.rowCount > 0;
}

async function listSectionsWithFields(filters = {}) {
  const fields = await listFields(filters);
  return fields.reduce((acc, field) => {
    if (!acc[field.section]) {
      acc[field.section] = [];
    }
    acc[field.section].push(field);
    return acc;
  }, {});
}

module.exports = {
  SECTION_ORDER,
  FIELD_TYPES,
  parseBooleanInput,
  validateTypedValue,
  validateFieldPayload,
  listFields,
  listSectionsWithFields,
  getFieldById,
  getFieldByKey,
  createField,
  updateField,
  deleteField
};
