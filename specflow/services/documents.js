const fs = require("fs");
const path = require("path");
const db = require("../db");
const env = require("../config/env");

const DOCS_DIR = path.resolve(env.storage.docsDir);
const MAX_DOCS_PER_EQUIPMENT = 10;
const MAX_DOC_SIZE_BYTES = 10 * 1024 * 1024;

function buildDocumentDownloadPath(documentId) {
  const id = Number(documentId);
  if (!Number.isInteger(id) || id <= 0) return "";
  return `/admin/documents/${id}/download`;
}

function ensureDocsDirectory() {
  try {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  } catch (err) {
    if (err.code === "EACCES") {
      const permissionError = new Error(`No write permission for docs directory: ${DOCS_DIR}`);
      permissionError.statusCode = 500;
      permissionError.errorCode = "DOC_STORAGE_PERMISSION";
      throw permissionError;
    }
    throw err;
  }
}

function normalizeDocumentRow(row) {
  const downloadPath = buildDocumentDownloadPath(row.id);
  return {
    id: Number(row.id),
    equipmentId: Number(row.equipment_id),
    originalName: row.original_name,
    storedName: row.stored_name,
    relativePath: row.relative_path,
    externalUrl: row.external_url,
    downloadPath,
    downloadUrl: downloadPath ? `${env.appBaseUrl.replace(/\/+$/, "")}${downloadPath}` : "",
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: row.created_at
  };
}

function sanitizeFileName(fileName) {
  const withoutExt = String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return withoutExt || "documento";
}

function isPdfContent(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  return buffer.slice(0, 5).toString("utf8") === "%PDF-";
}

function createStoredName(token, originalName) {
  const base = sanitizeFileName(originalName).slice(0, 50);
  const stamp = Date.now();
  return `${token}_${base}_${stamp}.pdf`;
}

async function listEquipmentDocuments(equipmentId) {
  const result = await db.query(
    `
      SELECT *
      FROM equipment_documents
      WHERE equipment_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [equipmentId]
  );
  return result.rows.map(normalizeDocumentRow);
}

async function getEquipmentDocumentById(id) {
  const result = await db.query(
    `
      SELECT *
      FROM equipment_documents
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );
  return result.rows[0] ? normalizeDocumentRow(result.rows[0]) : null;
}

async function countEquipmentDocuments(equipmentId) {
  const result = await db.query(
    "SELECT COUNT(*)::int AS total FROM equipment_documents WHERE equipment_id = $1",
    [equipmentId]
  );
  return Number(result.rows[0]?.total || 0);
}

async function saveEquipmentDocument({ equipmentId, token, originalName, mimeType, sizeBytes, buffer }) {
  const docsCount = await countEquipmentDocuments(equipmentId);
  if (docsCount >= MAX_DOCS_PER_EQUIPMENT) {
    const err = new Error("Maximum number of documents reached.");
    err.statusCode = 422;
    err.errorCode = "DOC_MAX_COUNT";
    throw err;
  }

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const err = new Error("Empty file.");
    err.statusCode = 422;
    err.errorCode = "DOC_EMPTY_FILE";
    throw err;
  }

  if (buffer.length > MAX_DOC_SIZE_BYTES || Number(sizeBytes || 0) > MAX_DOC_SIZE_BYTES) {
    const err = new Error("File exceeds 10MB.");
    err.statusCode = 422;
    err.errorCode = "DOC_FILE_TOO_LARGE";
    throw err;
  }

  if (!isPdfContent(buffer)) {
    const err = new Error("Only PDF files are allowed.");
    err.statusCode = 422;
    err.errorCode = "DOC_INVALID_TYPE";
    throw err;
  }

  ensureDocsDirectory();
  const storedName = createStoredName(token, originalName);
  const diskPath = path.join(DOCS_DIR, storedName);
  try {
    fs.writeFileSync(diskPath, buffer);
  } catch (err) {
    if (err.code === "EACCES") {
      const permissionError = new Error(`No write permission for file: ${diskPath}`);
      permissionError.statusCode = 500;
      permissionError.errorCode = "DOC_STORAGE_PERMISSION";
      throw permissionError;
    }
    throw err;
  }
  const relativePath = `/dados/docs/${storedName}`;
  const externalUrl = `${env.appBaseUrl.replace(/\/+$/, "")}${relativePath}`;

  const result = await db.query(
    `
      INSERT INTO equipment_documents (equipment_id, original_name, stored_name, relative_path, external_url, mime_type, size_bytes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `,
    [
      equipmentId,
      String(originalName || "documento.pdf"),
      storedName,
      relativePath,
      externalUrl,
      String(mimeType || "application/pdf"),
      Number(sizeBytes || buffer.length)
    ]
  );
  return normalizeDocumentRow(result.rows[0]);
}

module.exports = {
  DOCS_DIR,
  MAX_DOCS_PER_EQUIPMENT,
  MAX_DOC_SIZE_BYTES,
  buildDocumentDownloadPath,
  ensureDocsDirectory,
  getEquipmentDocumentById,
  listEquipmentDocuments,
  saveEquipmentDocument
};
