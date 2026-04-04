const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { STATUS_CODES } = require("http");
const { spawn } = require("child_process");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const csrf = require("csurf");
const rateLimit = require("express-rate-limit");
const dayjs = require("dayjs");

const env = require("./config/env");
const { migrate } = require("./db/migrate");
const { sanitizeInput, sanitizeRichTextInput } = require("./utils/sanitize");
const { SUPPORTED_LANGS, DEFAULT_LANG, normalizeLang, createTranslator } = require("./i18n");
const { buildSubmissionQrPayload, normalizeQrTheme } = require("./services/qr");
const { generatePdfBuffer } = require("./services/pdf");
const { sendSubmissionEmail, sendSmtpTestEmail } = require("./services/email");
const { getAdminSessionNotBefore } = require("./services/adminSessionState");
const {
  getAdminUserAccessByUsername,
  getAdminUserByUsername,
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  changeAdminUserPasswordByUsername,
  verifyAdminUserCredentials
} = require("./services/adminUsers");
const {
  MAX_TOKENS_PER_WINDOW,
  WINDOW_HOURS,
  hashIdentifier,
  getClientIp,
  checkPublicTokenCreationLimit,
  registerTokenCreationAudit
} = require("./services/publicTokenAccess");
const {
  listPublicTokenLinks,
  getPublicTokenLinkById,
  getPublicTokenLinkBySlug,
  createPublicTokenLink,
  setPublicTokenLinkActive,
  deletePublicTokenLinkById
} = require("./services/publicTokenLinks");
const {
  getEmailSettings,
  saveSmtpSettings,
  saveEmailDefaultRecipients,
  saveEmailHtmlTemplate,
  setDefaultEmailHtmlTemplate,
  deleteEmailHtmlTemplate
} = require("./services/emailSettings");
const {
  SUPPORTED_PDF_THEMES,
  normalizeTheme: normalizePdfTheme,
  normalizePdfPalette,
  getPdfTemplateSettings,
  savePdfTemplate,
  setDefaultPdfTemplateForTheme,
  deletePdfTemplate,
  resolvePdfTemplateForTheme
} = require("./services/pdfTemplateSettings");
const {
  getUserSystemFontKey,
  setUserSystemFontKey,
  listSystemFontOptions
} = require("./services/systemAppearance");
const {
  getReportServiceEmailSettings,
  saveReportServiceSmtpSettings,
  saveReportServiceEmailDefaultRecipients,
  saveReportServiceEmailHtmlTemplate,
  setDefaultReportServiceEmailHtmlTemplate,
  deleteReportServiceEmailHtmlTemplate
} = require("../report_service/src/services/emailSettings");
const {
  SECTION_ORDER,
  FIELD_TYPES,
  parseBooleanInput,
  validateTypedValue,
  listFields,
  listSectionsWithFields,
  getFieldById,
  createField,
  updateField,
  deleteField
} = require("./services/fields");
const { seedAnnexDFields } = require("./services/fieldSeed");
const {
  createEquipment,
  listEquipments,
  getEquipmentById,
  getEquipmentByToken,
  updateEquipmentClientData,
  updateEquipmentConfiguration,
  updateEquipmentStatus,
  deleteEquipmentById,
  getEnabledFieldIdsForEquipment,
  normalizeEquipmentStatus,
  EQUIPMENT_STATUS
} = require("./services/equipments");
const { getEquipmentSpecification, saveEquipmentSpecification } = require("./services/specifications");
const {
  listProfiles,
  getProfileById,
  getProfileFieldIds,
  listProfileEditableFields,
  listProfileFieldsForSpecification,
  createProfile,
  updateProfile,
  deleteProfile,
  createFieldInProfile,
  deleteFieldFromProfile,
  clearSectionFromProfile,
  clearAllFieldsFromProfile
} = require("./services/profiles");
const {
  MAX_DOCS_PER_EQUIPMENT,
  MAX_DOC_SIZE_BYTES,
  ensureDocsDirectory,
  getEquipmentDocumentById,
  listEquipmentDocuments,
  saveEquipmentDocument,
  deleteEquipmentDocumentById
} = require("./services/documents");
const {
  createApiKey,
  listApiKeys,
  deleteApiKey,
  authenticateApiKey,
  keyHasScope
} = require("./services/apiKeys");
const {
  listBackupFiles,
  getBackupFileById,
  deleteBackupFileById,
  syncBackupsFromDirectory
} = require("./services/backups");
const { generateProfileJsonFromDocument, reviseTextWithAi } = require("./services/aiProfiles");
const { getAiPromptTemplate, setAiPromptTemplate } = require("./services/aiPromptSettings");
const { registerReportService } = require("../report_service/src/app");

let registerModuleSpec = null;
let moduleSpecRepo = null;
let moduleSpecValidateMappingsPayload = null;
let moduleSpecExecuteSimpleFilter = null;

if (env.moduleSpecEnabled) {
  ({ registerModuleSpec } = require("../module_spec/src/app"));
  moduleSpecRepo = require("../module_spec/src/repositories/simpleRepository");
  ({
    validateMappingsPayload: moduleSpecValidateMappingsPayload,
    executeSimpleFilter: moduleSpecExecuteSimpleFilter
  } = require("../module_spec/src/services/simpleFilterService"));
}

const app = express();
app.set("view engine", "ejs");
app.set("views", [
  path.join(process.cwd(), "views"),
  path.join(__dirname, "views")
]);
app.set("trust proxy", 1);
app.disable("x-powered-by");

const appUsesHttps = String(env.appBaseUrl || "").toLowerCase().startsWith("https://");
const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
  imgSrc: ["'self'", "data:", "https://vextrom.com.br"],
  fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
  connectSrc: ["'self'"],
  upgradeInsecureRequests: appUsesHttps ? [] : null
};

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: cspDirectives
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-site" },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: "deny" },
  hsts: appUsesHttps
    ? {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
    : false,
  noSniff: true,
  referrerPolicy: { policy: "no-referrer" }
}));
app.use(express.urlencoded({ extended: false, limit: "25mb" }));
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/docs/report/img", express.static(path.join(process.cwd(), "docs", "report", "img")));
ensureDocsDirectory();

const supportedLangSet = new Set(SUPPORTED_LANGS);
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: appUsesHttps,
    path: "/"
  }
});
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const ADMIN_SESSION_COOKIE_NAME = env.admin.sessionCookieName;
const ADMIN_SESSION_TTL_MS = env.admin.sessionTtlHours * 60 * 60 * 1000;
const ADMIN_SESSION_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const PUBLIC_BROWSER_SESSION_COOKIE_NAME = "public_token_browser_session";
const PUBLIC_DRAFT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const CLIENT_CREATE_DEDUPE_TTL_MS = 15 * 1000;
const DEFAULT_NEW_CLIENT_PROFILE_NAME = "PADRÃO CHLORIDE";
const MAINTENANCE_MAX_OUTPUT_CHARS = 16000;
const MAINTENANCE_IMPORT_MAX_SQL_BYTES = 50 * 1024 * 1024;
const MAINTENANCE_IMPORT_RAW_LIMIT = "55mb";
const PROFILE_AI_MAX_FILE_BYTES = 10 * 1024 * 1024;
const packageMeta = require("../package.json");
const moduleVersions = packageMeta.moduleVersions || {};
const moduleStatuses = packageMeta.moduleStatuses || {};
const appVersionRaw = String(packageMeta.version || "0.0.0");
const appVersionShort = (() => {
  const [major = "0", minor = "0"] = appVersionRaw.split(".");
  return `v${major}.${minor}`;
})();
const recentClientCreateByKey = new Map();
const pendingClientCreateByKey = new Map();
const MODULE_ACCESS_KEYS = ["specflow", "module-spec", "report-service"];
const MODULE_ACCESS_SET = new Set(MODULE_ACCESS_KEYS);
const maintenanceImportRawParser = express.raw({
  type: "application/octet-stream",
  limit: MAINTENANCE_IMPORT_RAW_LIMIT
});

function resolveLanguage(req) {
  const queryLang = normalizeLang(req.query.lang);
  if (req.query.lang && supportedLangSet.has(queryLang)) return queryLang;
  const cookieLang = normalizeLang(req.cookies.lang);
  if (req.cookies.lang && supportedLangSet.has(cookieLang)) return cookieLang;
  const acceptLanguage = req.headers["accept-language"];
  if (acceptLanguage) {
    const headerLang = normalizeLang(acceptLanguage.split(",")[0]);
    if (supportedLangSet.has(headerLang)) return headerLang;
  }
  return DEFAULT_LANG;
}

app.use((req, res, next) => {
  Promise.resolve().then(async () => {
    const lang = resolveLanguage(req);
    if (normalizeLang(req.cookies.lang) !== lang) {
      res.cookie("lang", lang, { sameSite: "lax", maxAge: 365 * 24 * 60 * 60 * 1000 });
    }
    const sessionPayload = getAdminSessionPayload(req.cookies[ADMIN_SESSION_COOKIE_NAME]);
    const adminUsername = sessionPayload ? String(sessionPayload.username || "") : "";
    const adminAccess = await getAccessForAdminUsername(adminUsername);
    const adminRole = adminAccess.role;
    res.locals.isAdminAuthenticated = Boolean(sessionPayload);
    res.locals.adminUsername = adminUsername;
    res.locals.adminRole = adminRole || "";
    res.locals.adminModuleAccess = adminAccess.moduleAccess || [];
    res.locals.isMaintenanceAdmin = adminRole === "admin";
    req.adminUsername = adminUsername;
    req.adminRole = adminRole || "";
    req.adminModuleAccess = adminAccess.moduleAccess || [];
    req.lang = lang;
    req.t = createTranslator(lang);
    const appFontKey = await getUserSystemFontKey(adminUsername);
    res.locals.lang = lang;
    res.locals.t = req.t;
    res.locals.currentPath = req.path;
    res.locals.appFontKey = appFontKey;
    res.locals.appVersion = appVersionRaw;
    res.locals.appVersionShort = appVersionShort;
    res.locals.moduleSpecEnabled = env.moduleSpecEnabled;
    next();
  }).catch(next);
});

function signAdminSessionPayload(payload) {
  return crypto.createHmac("sha256", env.admin.sessionSecret).update(payload).digest("hex");
}

function safeTimingEqual(a, b) {
  const buffA = Buffer.from(String(a || ""));
  const buffB = Buffer.from(String(b || ""));
  if (buffA.length !== buffB.length) return false;
  return crypto.timingSafeEqual(buffA, buffB);
}

function shouldUseSecureCookies(req) {
  if (req.secure) return true;
  if (String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https") return true;
  return env.appBaseUrl.startsWith("https://");
}

function getOrCreatePublicBrowserSessionId(req, res) {
  const existing = sanitizeInput(req.cookies[PUBLIC_BROWSER_SESSION_COOKIE_NAME]);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  res.cookie(PUBLIC_BROWSER_SESSION_COOKIE_NAME, generated, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(req),
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: "/"
  });
  return generated;
}

function createPublicDraftToken() {
  const now = Date.now();
  const payloadObject = {
    issuedAt: now,
    expiresAt: now + PUBLIC_DRAFT_TOKEN_TTL_MS,
    nonce: crypto.randomBytes(12).toString("hex")
  };
  const encodedPayload = Buffer.from(JSON.stringify(payloadObject), "utf8").toString("base64url");
  const signature = signAdminSessionPayload(`public_draft:${encodedPayload}`);
  return Buffer.from(`${encodedPayload}.${signature}`, "utf8").toString("base64url");
}

function createPublicDisplayToken() {
  return crypto.randomBytes(8).toString("hex");
}

function isValidPublicDraftToken(token) {
  if (!token) return false;
  let rawToken;
  try {
    rawToken = Buffer.from(token, "base64url").toString("utf8");
  } catch (_err) {
    return false;
  }
  const splitIndex = rawToken.lastIndexOf(".");
  if (splitIndex <= 0) return false;
  const encodedPayload = rawToken.slice(0, splitIndex);
  const signature = rawToken.slice(splitIndex + 1);
  const expectedSignature = signAdminSessionPayload(`public_draft:${encodedPayload}`);
  if (!safeTimingEqual(signature, expectedSignature)) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (_err) {
    return false;
  }
  if (!payload || typeof payload !== "object") return false;
  if (!Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt)) return false;
  if (payload.expiresAt <= payload.issuedAt) return false;
  const now = Date.now();
  if (payload.issuedAt - now > ADMIN_SESSION_MAX_CLOCK_SKEW_MS) return false;
  if (now >= payload.expiresAt) return false;
  return true;
}

function createAdminSessionToken(username) {
  const now = Date.now();
  const payloadObject = {
    username: String(username || ""),
    issuedAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_MS,
    nonce: crypto.randomBytes(12).toString("hex")
  };
  const encodedPayload = Buffer.from(JSON.stringify(payloadObject), "utf8").toString("base64url");
  const signature = signAdminSessionPayload(encodedPayload);
  return Buffer.from(`${encodedPayload}.${signature}`, "utf8").toString("base64url");
}

function getAdminSessionPayload(token) {
  if (!token) return null;
  let rawToken;
  try {
    rawToken = Buffer.from(token, "base64url").toString("utf8");
  } catch (_err) {
    return null;
  }

  const splitIndex = rawToken.lastIndexOf(".");
  if (splitIndex <= 0) return null;
  const encodedPayload = rawToken.slice(0, splitIndex);
  const signature = rawToken.slice(splitIndex + 1);
  const expectedSignature = signAdminSessionPayload(encodedPayload);
  if (!safeTimingEqual(signature, expectedSignature)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (_err) {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;
  if (!String(payload.username || "")) return null;
  if (!Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt)) return null;
  if (payload.expiresAt <= payload.issuedAt) return null;

  const now = Date.now();
  if (payload.issuedAt - now > ADMIN_SESSION_MAX_CLOCK_SKEW_MS) return null;
  if (now >= payload.expiresAt) return null;
  const globalNotBefore = getAdminSessionNotBefore();
  if (payload.issuedAt < globalNotBefore) return null;
  return payload;
}

function isValidAdminSessionToken(token) {
  return Boolean(getAdminSessionPayload(token));
}

function getAdminSessionUsername(req) {
  const payload = getAdminSessionPayload(req.cookies[ADMIN_SESSION_COOKIE_NAME]);
  return payload ? String(payload.username || "") : "";
}

function hasModuleAccess(role, moduleAccess, moduleKey) {
  if (String(role || "").toLowerCase() === "admin") return true;
  const normalizedKey = String(moduleKey || "").trim().toLowerCase();
  if (!MODULE_ACCESS_SET.has(normalizedKey)) return false;
  const allowed = new Set((Array.isArray(moduleAccess) ? moduleAccess : []).map((item) => String(item || "").trim().toLowerCase()));
  return allowed.has(normalizedKey);
}

function normalizeModuleAccessInput(raw) {
  if (raw === null || raw === undefined) return [];
  const source = Array.isArray(raw) ? raw : [raw];
  const unique = new Set();
  source.forEach((item) => {
    const key = sanitizeInput(item).toLowerCase();
    if (MODULE_ACCESS_SET.has(key)) {
      unique.add(key);
    }
  });
  return Array.from(unique);
}

async function getAccessForAdminUsername(username) {
  const normalized = String(username || "").trim();
  if (!normalized) return { role: null, moduleAccess: [] };
  if (safeTimingEqual(normalized, String(env.admin.user || "").trim())) {
    return { role: "admin", moduleAccess: [...MODULE_ACCESS_KEYS] };
  }
  const access = await getAdminUserAccessByUsername(normalized);
  if (!access) return { role: null, moduleAccess: [] };
  return {
    role: access.role || "user",
    moduleAccess: Array.isArray(access.moduleAccess) ? access.moduleAccess : [...MODULE_ACCESS_KEYS]
  };
}

function requireAdminAuth(req, res, next) {
  if (isValidAdminSessionToken(req.cookies[ADMIN_SESSION_COOKIE_NAME])) return next();
  return res.redirect("/admin/login");
}

function getStandardStatusMessage(req, statusCode) {
  const parsedStatus = Number(statusCode);
  const normalizedStatus = Number.isInteger(parsedStatus) && parsedStatus >= 100 ? parsedStatus : 500;
  const fallbackStatus = normalizedStatus >= 500 ? 500 : 400;
  const translator = req && typeof req.t === "function" ? req.t : null;
  if (translator) {
    return translator(`http.${normalizedStatus}`) || translator(`http.${fallbackStatus}`);
  }
  return STATUS_CODES[normalizedStatus] || STATUS_CODES[fallbackStatus] || "Unexpected error";
}

function sendStandardError(req, res, statusCode, options = {}) {
  const message = getStandardStatusMessage(req, statusCode);
  const errorCode = options.errorCode || null;
  if (options.json) {
    return res.status(statusCode).json({
      error: message,
      errorCode,
      details: null
    });
  }
  return res.status(statusCode).send(message);
}

function requireMaintenanceAdmin(req, res, next) {
  const role = String(req.adminRole || "").toLowerCase();
  if (role === "admin") return next();
  const username = getAdminSessionUsername(req);
  Promise.resolve(getAccessForAdminUsername(username))
    .then((access) => {
      if (access.role === "admin") return next();
      return sendStandardError(req, res, 403);
    })
    .catch(next);
}

function requireModuleAccess(moduleKey) {
  return (req, res, next) => {
    const role = String(req.adminRole || "").toLowerCase();
    const moduleAccess = req.adminModuleAccess;
    if (hasModuleAccess(role, moduleAccess, moduleKey)) {
      return next();
    }

    const username = getAdminSessionUsername(req);
    Promise.resolve(getAccessForAdminUsername(username))
      .then((access) => {
        if (hasModuleAccess(access.role, access.moduleAccess, moduleKey)) return next();
        return sendStandardError(req, res, 403);
      })
      .catch(next);
  };
}

function requireAdminApiAuth(req, res, next) {
  if (isValidAdminSessionToken(req.cookies[ADMIN_SESSION_COOKIE_NAME])) return next();
  return sendStandardError(req, res, 403, { json: true, errorCode: "ADMIN_SESSION_REQUIRED" });
}

function runCommand(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({ ok: false, code: -1, output: `Falha ao executar comando: ${err.message}` });
    });
    child.on("close", (code) => {
      const trimmed = output.length > MAINTENANCE_MAX_OUTPUT_CHARS
        ? `${output.slice(0, MAINTENANCE_MAX_OUTPUT_CHARS)}\n...[saida truncada]`
        : output;
      resolve({ ok: code === 0, code, output: trimmed.trim() });
    });
  });
}

async function runNodeScripts(sequence) {
  let combinedOutput = "";
  for (const item of sequence) {
    const scriptPath = path.join(process.cwd(), item.script);
    const args = [scriptPath, ...(item.args || [])];
    // prefix output with command for easier diagnosis
    combinedOutput += `> ${process.execPath} ${args.join(" ")}\n`;
    const result = await runCommand(process.execPath, args);
    if (result.output) {
      combinedOutput += `${result.output}\n`;
    }
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        output: combinedOutput.trim()
      };
    }
  }
  return {
    ok: true,
    code: 0,
    output: combinedOutput.trim()
  };
}

function canEditEquipmentSpecification(req, equipment) {
  if (!equipment) return false;
  const status = normalizeEquipmentStatus(equipment.status);
  if (status === EQUIPMENT_STATUS.DRAFT) return true;
  return isValidAdminSessionToken(req.cookies[ADMIN_SESSION_COOKIE_NAME]);
}

function extractApiKeyFromRequest(req) {
  const authHeader = sanitizeInput(req.headers.authorization);
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice("bearer ".length).trim();
  }
  return sanitizeInput(req.headers["x-api-key"]);
}

function requireApiScope(scope) {
  return asyncHandler(async (req, res, next) => {
    if (isValidAdminSessionToken(req.cookies[ADMIN_SESSION_COOKIE_NAME])) {
      return next();
    }

    const rawApiKey = extractApiKeyFromRequest(req);
    if (!rawApiKey) {
      return sendStandardError(req, res, 401, { json: true, errorCode: "API_KEY_REQUIRED" });
    }

    const apiKey = await authenticateApiKey(rawApiKey);
    if (!apiKey) {
      return sendStandardError(req, res, 401, { json: true, errorCode: "API_KEY_INVALID" });
    }

    if (!keyHasScope(apiKey, scope)) {
      return sendStandardError(req, res, 403, { json: true, errorCode: "API_KEY_SCOPE_FORBIDDEN" });
    }

    req.apiKey = apiKey;
    return next();
  });
}

async function resolveEquipmentByTokenOr404(req, res) {
  const equipment = await getEquipmentByToken(req.params.token);
  if (!equipment) {
    sendStandardError(req, res, 404);
    return null;
  }
  return equipment;
}

function buildTokenDocumentDownloadPath(token, documentId) {
  const id = Number(documentId);
  if (!token || !Number.isInteger(id) || id <= 0) return "";
  return `/form/${encodeURIComponent(token)}/documents/${id}/download`;
}

function getBackupDirectoryPath() {
  return path.join(process.cwd(), "dados", "backups");
}

function extractBackupFileNameFromOutput(output) {
  const text = String(output || "");
  const matches = text.match(/Backup(?:\s+[a-z-]+)?\s+concluido:\s*([^\r\n]+\.sql)/i);
  if (!matches || !matches[1]) return "";
  const candidate = path.basename(matches[1].trim());
  if (!/^(db-backup|specflow-backup|config-backup|module-spec-backup|report-service-backup|db-import)-.*\.sql$/i.test(candidate)) return "";
  return candidate;
}

function buildAdminBackupDownloadPath(backupId) {
  const id = Number(backupId);
  if (!Number.isInteger(id) || id <= 0) return "";
  return `/admin/backups/${id}/download`;
}

function resolveRestoreModuleFromBackupPath(backupFilePath) {
  const fileName = path.basename(String(backupFilePath || "")).toLowerCase();
  if (!fileName.endsWith(".sql")) return "";
  if (fileName.startsWith("module-spec-backup-")) return "module-spec";
  if (fileName.startsWith("report-service-backup-")) return "report-service";
  if (fileName.startsWith("config-backup-")) return "config";
  if (fileName.startsWith("specflow-backup-") || fileName.startsWith("db-backup-") || fileName.startsWith("db-import-")) {
    return "specflow";
  }
  return "";
}

function buildRestoreScriptArgs(backupFilePath) {
  const moduleName = resolveRestoreModuleFromBackupPath(backupFilePath);
  const args = [];
  if (moduleName) {
    args.push(`--module=${moduleName}`);
  }
  args.push(backupFilePath);
  return { moduleName, args };
}

function sanitizeImportedBackupFileName(fileName) {
  const base = path.basename(String(fileName || "").trim() || "import.sql");
  const normalized = base
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  const withExt = normalized.toLowerCase().endsWith(".sql") ? normalized : `${normalized || "import"}.sql`;
  return withExt;
}

function buildImportedBackupFilePath(originalFileName) {
  const safeName = sanitizeImportedBackupFileName(originalFileName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = getBackupDirectoryPath();
  fs.mkdirSync(backupDir, { recursive: true });
  return path.join(backupDir, `db-import-${timestamp}-${safeName}`);
}

function resolveImportedSqlBuffer(req) {
  const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  if (!payload.length) {
    throw new Error("Arquivo SQL nao recebido.");
  }
  if (payload.length > MAINTENANCE_IMPORT_MAX_SQL_BYTES) {
    throw new Error(`Arquivo SQL excede limite de ${(MAINTENANCE_IMPORT_MAX_SQL_BYTES / (1024 * 1024)).toFixed(0)} MB.`);
  }
  const fileNameHeaderRaw = String(req.headers["x-sql-file-name"] || "").trim();
  if (!fileNameHeaderRaw || !fileNameHeaderRaw.toLowerCase().endsWith(".sql")) {
    throw new Error("Somente arquivos .sql sao permitidos.");
  }
  const fileName = sanitizeImportedBackupFileName(fileNameHeaderRaw);
  return { buffer: payload, fileName };
}

async function loadBackupsForMaintenancePage() {
  await syncBackupsFromDirectory(getBackupDirectoryPath());
  return listBackupFiles();
}

async function renderAdminMaintenancePage(req, res, options = {}) {
  const backups = options.backups || await loadBackupsForMaintenancePage();
  const emailSettings = options.emailSettings || await getEmailSettings();
  const pdfTemplateSettings = options.pdfTemplateSettings || await getPdfTemplateSettings();

  return res.status(options.statusCode || 200).render("admin-maintenance", {
    pageTitle: "Manutencao administrativa",
    commandResult: options.commandResult || null,
    smtpUpdateResult: options.smtpUpdateResult || null,
    smtpTestResult: options.smtpTestResult || null,
    emailTemplatesUpdateResult: options.emailTemplatesUpdateResult || null,
    pdfTemplateUpdateResult: options.pdfTemplateUpdateResult || null,
    pdfTemplateDefaultResult: options.pdfTemplateDefaultResult || null,
    defaultRecipientsUpdateResult: options.defaultRecipientsUpdateResult || null,
    emailTemplateEditorValues: options.emailTemplateEditorValues || {
      template_id: "",
      template_name: "",
      template_subject: "",
      template_html: "",
      set_default_template: false
    },
    pdfTemplateEditorValues: options.pdfTemplateEditorValues || {
      template_id: "",
      template_name: "",
      template_theme: "xvextrom",
      card_background: "",
      border_color: "",
      title_color: "",
      header_color: "",
      text_color: "",
      row_even_background: "",
      row_odd_background: "",
      line_color: "",
      badge_background: "",
      badge_border: "",
      badge_text: ""
    },
    maintenanceEmailTestTo: options.maintenanceEmailTestTo || "",
    backups,
    emailSettings,
    pdfTemplateSettings,
    pdfTemplateThemes: SUPPORTED_PDF_THEMES,
    publicTokenMaxPerWindow: MAX_TOKENS_PER_WINDOW,
    publicTokenWindowHours: WINDOW_HOURS,
    csrfToken: req.csrfToken()
  });
}

async function renderSystemMaintenancePage(req, res, options = {}) {
  const isSystemAdmin = String(req.adminRole || "").toLowerCase() === "admin";
  const users = isSystemAdmin ? (options.users || await listAdminUsers()) : [];
  const backups = isSystemAdmin ? (options.backups || await loadBackupsForMaintenancePage()) : [];
  const currentSystemFont = options.currentSystemFont || await getUserSystemFontKey(req.adminUsername || "");
  const systemFontOptions = listSystemFontOptions();
  return res.status(options.statusCode || 200).render("admin-maintenance-system", {
    pageTitle: "Manutencao do sistema",
    canManageSystem: isSystemAdmin,
    commandResult: options.commandResult || null,
    systemFontResult: options.systemFontResult || null,
    selfPasswordResult: options.selfPasswordResult || null,
    userCreateResult: options.userCreateResult || null,
    userUpdateResult: options.userUpdateResult || null,
    userDeleteResult: options.userDeleteResult || null,
    users,
    backups,
    currentSystemFont,
    systemFontOptions,
    envAdminUser: env.admin.user,
    maintenanceCards: [
      {
        title: "SpecFlow",
        description: "Backup do banco, links publicos e configuracao/template de e-mail.",
        href: "/admin/maintenance/specflow"
      },
      {
        title: "Module Spec",
        description: "Backup do banco dedicado do modulo.",
        href: "/admin/maintenance/module-spec"
      },
      {
        title: "Report Service",
        description: "Backup do banco, configuracao de e-mail e templates do modulo.",
        href: "/admin/maintenance/report-service"
      }
    ],
    csrfToken: req.csrfToken()
  });
}

function renderModuleSpecMaintenancePage(req, res, options = {}) {
  return res.status(options.statusCode || 200).render("admin-maintenance-module-spec", {
    pageTitle: "Manutencao Module Spec",
    commandResult: options.commandResult || null,
    csrfToken: req.csrfToken()
  });
}

async function renderReportServiceMaintenancePage(req, res, options = {}) {
  const emailSettings = options.emailSettings || await getReportServiceEmailSettings();
  return res.status(options.statusCode || 200).render("admin-maintenance-report-service", {
    pageTitle: "Manutencao Report Service",
    commandResult: options.commandResult || null,
    smtpUpdateResult: options.smtpUpdateResult || null,
    emailTemplatesUpdateResult: options.emailTemplatesUpdateResult || null,
    defaultRecipientsUpdateResult: options.defaultRecipientsUpdateResult || null,
    emailTemplateEditorValues: options.emailTemplateEditorValues || {
      template_id: "",
      template_name: "",
      template_subject: "",
      template_html: "",
      set_default_template: false
    },
    emailSettings,
    csrfToken: req.csrfToken()
  });
}

function withTokenDocumentLinks(documents, token) {
  const source = Array.isArray(documents) ? documents : [];
  const baseUrl = String(env.appBaseUrl || "").replace(/\/+$/, "");
  return source.map((document) => {
    const downloadPath = buildTokenDocumentDownloadPath(token, document.id);
    return {
      ...document,
      downloadPath: downloadPath || document.downloadPath || "",
      downloadUrl: downloadPath ? `${baseUrl}${downloadPath}` : (document.downloadUrl || "")
    };
  });
}

function parseFieldPayloadFromBody(body) {
  const enumLines = String(body.enum_options || "")
    .split(/\r?\n/)
    .map((line) => sanitizeInput(line))
    .filter(Boolean);
  const hasDefault = parseBooleanInput(body.has_default) === true;
  return {
    key: sanitizeInput(body.key),
    label: sanitizeInput(body.label),
    section: sanitizeInput(body.section),
    fieldType: sanitizeInput(body.field_type),
    unit: sanitizeInput(body.unit),
    enumOptions: enumLines,
    hasDefault,
    defaultValue: hasDefault ? sanitizeInput(body.default_value) : null
  };
}

function parseSelectedFieldIds(input) {
  const source = Array.isArray(input) ? input : [input];
  const unique = new Set();
  source.forEach((item) => {
    const parsed = Number(sanitizeInput(item));
    if (Number.isInteger(parsed) && parsed > 0) {
      unique.add(parsed);
    }
  });
  return Array.from(unique);
}

function parseApiKeyScopes(input) {
  return String(input || "")
    .split(",")
    .map((part) => sanitizeInput(part).toLowerCase())
    .filter(Boolean);
}

function parseProfileFieldsFromBody(baseFields, body) {
  return baseFields.map((field) => {
    const id = Number(field.fieldId || field.id);
    const enumText = sanitizeInput(body[`pf_enum_options_${id}`] || "");
    const enumOptions = enumText
      ? enumText.split(/\r?\n/).map((line) => sanitizeInput(line)).filter(Boolean)
      : null;
    const hasDefault = parseBooleanInput(body[`pf_has_default_${id}`]) === true;
    const isRequiredRaw = parseBooleanInput(body[`pf_required_${id}`]);
    const isRequired = isRequiredRaw === null ? Boolean(field.isRequired) : isRequiredRaw === true;
    const defaultValueRaw = sanitizeInput(body[`pf_default_value_${id}`]);
    return {
      fieldId: id,
      isEnabled: parseBooleanInput(body[`pf_enabled_${id}`]) === true,
      isRequired,
      label: sanitizeInput(body[`pf_label_${id}`] || field.label || ""),
      section: sanitizeInput(body[`pf_section_${id}`] || field.section || ""),
      fieldType: sanitizeInput(body[`pf_field_type_${id}`] || field.fieldType || "text"),
      unit: sanitizeInput(body[`pf_unit_${id}`] || field.unit || ""),
      enumOptions,
      hasDefault,
      defaultValue: hasDefault ? defaultValueRaw : null,
      displayOrder: Number(sanitizeInput(body[`pf_display_order_${id}`] || field.displayOrder || 0))
    };
  });
}

function parseProfileNewFieldFromBody(body, fallbackSection = "General") {
  const enumLines = String(body.new_field_enum_options || "")
    .split(/\r?\n/)
    .map((line) => sanitizeInput(line))
    .filter(Boolean);
  const hasDefault = parseBooleanInput(body.new_field_has_default) === true;
  const isRequired = parseBooleanInput(body.new_field_is_required) === true;
  return {
    key: sanitizeInput(body.new_field_key),
    label: sanitizeInput(body.new_field_label),
    section: sanitizeInput(body.new_field_section) || fallbackSection,
    fieldType: sanitizeInput(body.new_field_field_type) || "text",
    unit: sanitizeInput(body.new_field_unit),
    enumOptions: enumLines,
    isRequired,
    hasDefault,
    defaultValue: hasDefault ? sanitizeInput(body.new_field_default_value) : null
  };
}

function normalizeImportedProfileField(field, index = 0) {
  const source = field && typeof field === "object" ? field : {};
  const hasDefault = parseBooleanInput(source.hasDefault) === true;
  const fieldType = sanitizeInput(source.fieldType || source.field_type || "text").toLowerCase();
  const enumOptions = Array.isArray(source.enumOptions)
    ? source.enumOptions
    : (Array.isArray(source.enum_options) ? source.enum_options : []);
  return {
    key: sanitizeInput(source.key || ""),
    label: sanitizeInput(source.label || source.key || `Campo ${index + 1}`),
    section: sanitizeInput(source.section || "General"),
    fieldType,
    unit: sanitizeInput(source.unit || ""),
    enumOptions: enumOptions.map((item) => sanitizeInput(item)).filter(Boolean),
    isRequired: parseBooleanInput(source.isRequired ?? source.is_required) === true,
    hasDefault,
    defaultValue: hasDefault ? source.defaultValue ?? source.default_value ?? "" : null,
    isEnabled: parseBooleanInput(source.isEnabled ?? source.is_enabled) !== false,
    displayOrder: Number(source.displayOrder ?? source.display_order ?? index + 1)
  };
}

function parseImportedProfilePayload(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    const err = new Error("JSON vazio.");
    err.statusCode = 422;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    const err = new Error("JSON invalido.");
    err.statusCode = 422;
    throw err;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const err = new Error("Estrutura de JSON invalida.");
    err.statusCode = 422;
    throw err;
  }

  const name = sanitizeInput(parsed.name);
  if (!name) {
    const err = new Error("O campo 'name' e obrigatorio.");
    err.statusCode = 422;
    throw err;
  }

  const fieldsInput = Array.isArray(parsed.fields) ? parsed.fields : [];
  if (!fieldsInput.length) {
    const err = new Error("O campo 'fields' deve conter ao menos um item.");
    err.statusCode = 422;
    throw err;
  }

  const fields = fieldsInput.map((field, index) => normalizeImportedProfileField(field, index));
  return { name, fields };
}

function parseImportedSubmissionPayload(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    const err = new Error("JSON vazio.");
    err.statusCode = 422;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    const err = new Error("JSON invalido.");
    err.statusCode = 422;
    throw err;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const err = new Error("Estrutura de JSON invalida.");
    err.statusCode = 422;
    throw err;
  }

  const meta = parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {};
  const client = parsed.client && typeof parsed.client === "object" ? parsed.client : {};
  const configuration = parsed.configuration && typeof parsed.configuration === "object" ? parsed.configuration : {};

  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
  if (!sections.length) {
    const err = new Error("O campo 'sections' deve conter ao menos um item.");
    err.statusCode = 422;
    throw err;
  }

  const values = {};
  sections.forEach((section) => {
    const fields = Array.isArray(section && section.fields) ? section.fields : [];
    fields.forEach((field) => {
      const fieldId = Number(field && field.id);
      if (!Number.isInteger(fieldId) || fieldId <= 0) return;
      if (Object.prototype.hasOwnProperty.call(field, "value")) {
        values[fieldId] = field.value;
      }
    });
  });

  if (!Object.keys(values).length) {
    const err = new Error("Nenhum campo valido foi encontrado no JSON.");
    err.statusCode = 422;
    throw err;
  }

  return {
    token: sanitizeInput(meta.token || ""),
    clientData: {
      purchaser: sanitizeInput(client.purchaser || ""),
      purchaserContact: sanitizeInput(client.purchaserContact || client.purchaser_contact || ""),
      contactEmail: sanitizeInput(client.contactEmail || client.contact_email || ""),
      contactPhone: sanitizeInput(client.contactPhone || client.contact_phone || ""),
      projectName: sanitizeInput(client.projectName || client.project_name || ""),
      siteName: sanitizeInput(client.siteName || client.site_name || ""),
      address: sanitizeInput(client.address || "")
    },
    configuration: {
      profileId: Number.isInteger(Number(configuration.profileId ?? configuration.profile_id))
        && Number(configuration.profileId ?? configuration.profile_id) > 0
        ? Number(configuration.profileId ?? configuration.profile_id)
        : null,
      enabledFieldIds: Array.isArray(configuration.enabledFieldIds ?? configuration.enabled_field_ids)
        ? (configuration.enabledFieldIds ?? configuration.enabled_field_ids)
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item > 0)
        : null
    },
    values
  };
}

function buildSubmissionExportPayload(equipment, specification, enabledFieldIds = []) {
  return {
    meta: {
      token: equipment.token,
      status: equipment.status,
      created_at: equipment.createdAt,
      updated_at: equipment.updatedAt,
      exported_at: dayjs().toISOString()
    },
    client: {
      purchaser: equipment.purchaser || "",
      purchaserContact: equipment.purchaserContact || "",
      contactEmail: equipment.contactEmail || "",
      contactPhone: equipment.contactPhone || "",
      projectName: equipment.projectName || "",
      siteName: equipment.siteName || "",
      address: equipment.address || ""
    },
    configuration: {
      profile_id: equipment.profileId || null,
      enabled_field_ids: Array.isArray(enabledFieldIds) ? enabledFieldIds : []
    },
    sections: specification.sections.map((section) => ({
      section: section.section,
      fields: section.fields.map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        unit: field.unit || null,
        value: field.effectiveValue,
        source: field.valueSource || "empty"
      }))
    }))
  };
}

function buildProfileExportPayload(profile, fields) {
  const normalizedFields = (Array.isArray(fields) ? fields : []).map((field, index) => ({
    key: field.key,
    label: field.label || "",
    section: field.section || "General",
    fieldType: field.fieldType || "text",
    unit: field.unit || null,
    enumOptions: Array.isArray(field.enumOptions) ? field.enumOptions : [],
    isRequired: Boolean(field.isRequired),
    hasDefault: Boolean(field.hasDefault),
    defaultValue: field.hasDefault ? field.defaultValue : null,
    isEnabled: field.isEnabled !== false,
    displayOrder: Number(field.displayOrder || index + 1)
  }));

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    name: profile && profile.name ? profile.name : "",
    fields: normalizedFields
  };
}

function buildAiProfileJsonTemplate() {
  return JSON.stringify({
    name: "Nome do Perfil",
    fields: [
      {
        key: "exemplo_campo",
        label: "Exemplo de campo",
        section: "General",
        fieldType: "text",
        unit: null,
        enumOptions: [],
        isRequired: false,
        hasDefault: false,
        defaultValue: null,
        isEnabled: true,
        displayOrder: 1
      }
    ]
  }, null, 2);
}

function resolveProfileAiMimeType(rawMimeType, fileName = "") {
  const normalizedMime = sanitizeInput(rawMimeType || "").toLowerCase();
  if (normalizedMime && normalizedMime !== "application/octet-stream") {
    return normalizedMime;
  }
  const normalizedName = String(fileName || "").trim().toLowerCase();
  if (normalizedName.endsWith(".pdf")) return "application/pdf";
  if (normalizedName.endsWith(".txt")) return "text/plain";
  if (normalizedName.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (normalizedName.endsWith(".xls")) return "application/vnd.ms-excel";
  return normalizedMime;
}

function parseClientDataFromBody(body) {
  return {
    purchaser: sanitizeInput(body.purchaser),
    purchaserContact: sanitizeInput(body.purchaser_contact),
    contactEmail: sanitizeInput(body.contact_email),
    contactPhone: sanitizeInput(body.contact_phone),
    projectName: sanitizeInput(body.project_name),
    siteName: sanitizeInput(body.site_name),
    address: sanitizeInput(body.address)
  };
}

function validateClientData(clientData, t) {
  const errors = {};
  if (!clientData.purchaser) errors.purchaser = t("admin.newClientRequired");
  if (!clientData.purchaserContact) errors.purchaser_contact = t("admin.newClientRequired");
  if (!clientData.contactEmail) errors.contact_email = t("admin.newClientRequired");
  if (!clientData.contactPhone) errors.contact_phone = t("admin.newClientRequired");
  if (!clientData.projectName) errors.project_name = t("admin.newClientRequired");
  if (!clientData.siteName) errors.site_name = t("admin.newClientRequired");
  if (!clientData.address) errors.address = t("admin.newClientRequired");
  if (clientData.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientData.contactEmail)) {
    errors.contact_email = t("admin.invalidEmail");
  }
  return errors;
}

function parseEmailListInput(raw) {
  return String(raw || "")
    .split(/[;,]/)
    .map((item) => sanitizeInput(item).trim())
    .filter(Boolean);
}

function mergeEmailLists(...lists) {
  const merged = [];
  const seen = new Set();
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((item) => {
      const email = String(item || "").trim();
      if (!email) return;
      const normalized = email.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      merged.push(email);
    });
  });
  return merged;
}

function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function resolveUiTheme(req) {
  return normalizeQrTheme(req.cookies.app_theme);
}

function resolvePdfUiTheme(req) {
  return normalizePdfTheme(req.cookies.app_theme);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTokenOpenGraph(equipment, view = "specification") {
  const cleanBaseUrl = String(env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  const token = encodeURIComponent(String(equipment && equipment.token ? equipment.token : ""));
  const safeView = String(view || "specification").toLowerCase() === "review" ? "review" : "specification";
  const profileName = sanitizeInput(equipment && equipment.profileName ? equipment.profileName : "") || "SpecFlow";
  const purchaser = sanitizeInput(equipment && equipment.purchaser ? equipment.purchaser : "");
  const projectName = sanitizeInput(equipment && equipment.projectName ? equipment.projectName : "");
  const descriptionParts = [
    purchaser || "Formulario tecnico",
    projectName || "Especificacao",
    `Token ${sanitizeInput(equipment && equipment.token ? equipment.token : "") || "-"}`
  ];
  return {
    title: `${profileName} | Vextrom`,
    description: descriptionParts.join(" - "),
    image: `${cleanBaseUrl}/og/token/${token}.svg`,
    url: `${cleanBaseUrl}/form/${token}/${safeView}`
  };
}

function randomInt(min, max) {
  const safeMin = Number(min) || 0;
  const safeMax = Number(max) || safeMin;
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function buildPdfPreviewMockData(lang) {
  const sectionNames = lang === "en"
    ? ["General Data", "Environmental Conditions", "Electrical Characteristics"]
    : ["Dados Gerais", "Condicoes Ambientais", "Caracteristicas Eletricas"];
  const fieldPool = [
    { label: "Potencia nominal requerida", unit: "kVA" },
    { label: "Fator de potencia requerido", unit: "fp" },
    { label: "Grau de protecao", unit: "-" },
    { label: "Pressao minima permitida", unit: "kPa" },
    { label: "Elevacao maxima", unit: "metros" },
    { label: "Umidade relativa", unit: "%" },
    { label: "Frequencia de entrada", unit: "Hz" },
    { label: "Tensao de saida", unit: "V" },
    { label: "Corrente nominal", unit: "A" }
  ];

  const token = `preview-${Date.now().toString().slice(-6)}`;
  const submission = {
    token,
    purchaser: "Cliente Preview Template",
    purchaserContact: "Contato Exemplo",
    contactEmail: "preview@cliente.com",
    contactPhone: "(11) 99999-0000",
    projectName: "Projeto Demonstracao",
    siteName: "Site Alfa",
    address: "Av. Exemplo, 1000 - Sao Paulo/SP",
    status: "draft",
    created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
    updated_at: new Date().toISOString()
  };

  const sections = sectionNames.map((sectionName, sectionIndex) => {
    const fields = Array.from({ length: 6 }).map((_, fieldIndex) => {
      const base = fieldPool[(sectionIndex * 3 + fieldIndex) % fieldPool.length];
      const numericValue = randomInt(1, 120);
      const value = base.unit === "-" ? `VAL-${randomInt(10, 99)}` : `${numericValue}`;
      const cameFromDefault = fieldIndex % 2 === 0;
      return {
        label: base.label,
        unit: base.unit,
        displayValue: value,
        cameFromDefault
      };
    });
    return {
      section: sectionName,
      fields
    };
  });

  const documents = [
    { originalName: "diagrama-unifilar-preview.pdf" },
    { originalName: "diagrama-trifilar-preview.pdf" }
  ];

  return { submission, sections, documents };
}

function cleanupExpiredClientCreates(now = Date.now()) {
  for (const [key, value] of recentClientCreateByKey.entries()) {
    if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) {
      recentClientCreateByKey.delete(key);
    }
  }
}

function buildClientCreateDedupeKey(req, clientData, profileId, enabledFieldIds) {
  const sessionToken = sanitizeInput(req.cookies[ADMIN_SESSION_COOKIE_NAME]) || "anonymous";
  const payload = {
    purchaser: sanitizeInput(clientData.purchaser),
    purchaserContact: sanitizeInput(clientData.purchaserContact),
    contactEmail: sanitizeInput(clientData.contactEmail),
    contactPhone: sanitizeInput(clientData.contactPhone),
    projectName: sanitizeInput(clientData.projectName),
    siteName: sanitizeInput(clientData.siteName),
    address: sanitizeInput(clientData.address),
    profileId: Number.isInteger(Number(profileId)) && Number(profileId) > 0 ? Number(profileId) : null,
    enabledFieldIds: Array.isArray(enabledFieldIds)
      ? Array.from(new Set(enabledFieldIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))).sort((a, b) => a - b)
      : []
  };
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return `${sessionToken}:${hash}`;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[left.length][right.length];
}

function tokenSimilarity(a, b) {
  const left = normalizeSearchText(a);
  const right = normalizeSearchText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.startsWith(right) || right.startsWith(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }
  const distance = levenshteinDistance(left, right);
  const base = Math.max(left.length, right.length);
  return Math.max(0, 1 - distance / base);
}

function smartSearchScore(sourceText, queryText) {
  const source = normalizeSearchText(sourceText);
  const query = normalizeSearchText(queryText);
  if (!query) return 1;
  if (!source) return 0;
  if (source.includes(query)) return 1;

  const sourceTokens = source.split(" ").filter(Boolean);
  const queryTokens = query.split(" ").filter(Boolean);
  if (!queryTokens.length || !sourceTokens.length) return 0;

  const tokenScores = queryTokens.map((queryToken) => {
    let best = 0;
    for (const sourceToken of sourceTokens) {
      const score = tokenSimilarity(sourceToken, queryToken);
      if (score > best) best = score;
      if (best >= 1) break;
    }
    return best;
  });

  return tokenScores.reduce((sum, score) => sum + score, 0) / tokenScores.length;
}

async function buildThemeAwareQrData(token) {
  const [softQr, vextromQr] = await Promise.all([
    buildSubmissionQrPayload(token, [], "soft"),
    buildSubmissionQrPayload(token, [], "vextrom")
  ]);
  return {
    soft: softQr.qrDataUrl,
    vextrom: vextromQr.qrDataUrl
  };
}

async function getSpecificationTemplate(lang = "en") {
  const fields = await listFields({ lang });
  const grouped = fields.reduce((acc, field) => {
    if (!acc[field.section]) acc[field.section] = [];
    acc[field.section].push(field);
    return acc;
  }, {});

  return {
    equipmentId: null,
    sections: Object.entries(grouped).map(([sectionName, sectionFields]) => ({
      section: sectionName,
      fields: sectionFields.map((field) => ({
        ...field,
        effectiveValue: field.hasDefault ? field.defaultValue : null,
        valueSource: field.hasDefault ? "default" : "empty"
      }))
    }))
  };
}

async function getSpecificationTemplateForProfile(profileId) {
  const fields = await listProfileFieldsForSpecification(profileId);
  const grouped = fields.reduce((acc, field) => {
    if (!acc[field.section]) acc[field.section] = [];
    acc[field.section].push(field);
    return acc;
  }, {});

  return {
    equipmentId: null,
    sections: Object.entries(grouped).map(([sectionName, sectionFields]) => ({
      section: sectionName,
      fields: sectionFields.map((field) => ({
        ...field,
        effectiveValue: field.hasDefault ? field.defaultValue : null,
        valueSource: field.hasDefault ? "default" : "empty"
      }))
    }))
  };
}

async function renderAdminPublicTokenLinksPage(req, res, options = {}) {
  const [profiles, links] = await Promise.all([
    listProfiles(),
    listPublicTokenLinks()
  ]);

  res.status(options.statusCode || 200).render("admin-public-token-links", {
    pageTitle: req.t("admin.publicTokenLinksTitle"),
    profiles,
    links,
    formValues: {
      profile_id: options.formValues?.profile_id || ""
    },
    formErrors: options.formErrors || {},
    created: req.query.created === "1",
    deleted: req.query.deleted === "1",
    toggled: req.query.toggled === "1",
    flashError: options.flashError || null,
    publicTokenWindowHours: WINDOW_HOURS,
    publicTokenMaxPerWindow: MAX_TOKENS_PER_WINDOW,
    appBaseUrl: env.appBaseUrl.replace(/\/+$/, ""),
    csrfToken: req.csrfToken()
  });
}

async function renderAdminFieldsPage(req, res, options = {}) {
  const groupedMap = await listSectionsWithFields({ lang: req.lang });
  const presentSections = Object.keys(groupedMap).filter((section) => !SECTION_ORDER.includes(section));
  const sectionNames = [...SECTION_ORDER, ...presentSections];
  const sections = sectionNames
    .map((name) => ({ name, fields: groupedMap[name] || [] }))
    .filter((item) => item.fields.length > 0 || item.name === options.formValues?.section);

  res.status(options.statusCode || 200).render("admin-fields", {
    pageTitle: req.t("admin.fieldsTitle"),
    sections,
    sectionNames: [...SECTION_ORDER, ...presentSections],
    fieldTypes: Array.from(FIELD_TYPES),
    editingFieldId: options.editingFieldId || "",
    formValues: options.formValues || {
      key: "",
      label: "",
      section: options.prefillSection || SECTION_ORDER[0],
      field_type: "text",
      unit: "",
      enum_options: "",
      has_default: false,
      default_value: ""
    },
    errors: options.errors || {},
    saved: req.query.saved === "1",
    deleted: req.query.deleted === "1",
    csrfToken: req.csrfToken()
  });
}

async function renderAdminNewClientPage(req, res, options = {}) {
  const groupedMap = await listSectionsWithFields({ lang: req.lang });
  const presentSections = Object.keys(groupedMap).filter((section) => !SECTION_ORDER.includes(section));
  const sectionNames = [...SECTION_ORDER, ...presentSections];
  const sections = sectionNames
    .map((name) => ({ name, fields: groupedMap[name] || [] }))
    .filter((item) => item.fields.length > 0);
  const profiles = await listProfiles();
  const profileFieldPairs = await Promise.all(
    profiles.map(async (profile) => [String(profile.id), await getProfileFieldIds(profile.id)])
  );
  const profileFieldMap = Object.fromEntries(profileFieldPairs);
  const allFieldIds = sections.flatMap((section) => section.fields.map((field) => field.id));
  const selectedFieldIds = Array.isArray(options.selectedFieldIds) ? options.selectedFieldIds : allFieldIds;
  const defaultProfile = profiles.find((profile) => profile.name === DEFAULT_NEW_CLIENT_PROFILE_NAME);
  const values = options.values || {
    purchaser: "",
    purchaser_contact: "",
    contact_email: "",
    contact_phone: "",
    project_name: "",
    site_name: "",
    address: "",
    profile_id: defaultProfile ? String(defaultProfile.id) : ""
  };

  res.status(options.statusCode || 200).render("admin-new-client", {
    pageTitle: req.t("admin.newClientTitle"),
    values,
    errors: options.errors || {},
    sections,
    profiles,
    profileFieldMap,
    selectedFieldIds,
    csrfToken: req.csrfToken()
  });
}

async function buildFieldPickerData(lang) {
  const groupedMap = await listSectionsWithFields({ lang });
  const presentSections = Object.keys(groupedMap).filter((section) => !SECTION_ORDER.includes(section));
  const sectionNames = [...SECTION_ORDER, ...presentSections];
  const sections = sectionNames
    .map((name) => ({ name, fields: groupedMap[name] || [] }))
    .filter((item) => item.fields.length > 0);
  const profiles = await listProfiles();
  const profileFieldPairs = await Promise.all(
    profiles.map(async (profile) => [String(profile.id), await getProfileFieldIds(profile.id)])
  );
  const profileFieldMap = Object.fromEntries(profileFieldPairs);
  const allFieldIds = sections.flatMap((section) => section.fields.map((field) => field.id));
  return { sections, profiles, profileFieldMap, allFieldIds };
}

async function getAllowedSelectedFieldIds(profileId, selectedFieldIds) {
  const selectedSet = new Set(Array.isArray(selectedFieldIds) ? selectedFieldIds.map(Number) : []);
  if (!profileId) return Array.from(selectedSet).filter((id) => Number.isInteger(id) && id > 0);
  const allowed = await getProfileFieldIds(profileId);
  const allowedSet = new Set(allowed);
  return Array.from(selectedSet).filter((id) => allowedSet.has(id));
}

async function renderAdminClientConfigPage(req, res, equipment, options = {}) {
  const picker = await buildFieldPickerData(req.lang);
  const selectedFieldIds = Array.isArray(options.selectedFieldIds) ? options.selectedFieldIds : await getEnabledFieldIdsForEquipment(equipment.id);
  res.status(options.statusCode || 200).render("admin-client-config", {
    pageTitle: req.t("admin.clientConfigTitle"),
    equipment,
    values: options.values || {
      purchaser: equipment.purchaser || "",
      purchaser_contact: equipment.purchaserContact || "",
      contact_email: equipment.contactEmail || "",
      contact_phone: equipment.contactPhone || "",
      project_name: equipment.projectName || "",
      site_name: equipment.siteName || "",
      address: equipment.address || "",
      profile_id: equipment.profileId ? String(equipment.profileId) : ""
    },
    errors: options.errors || {},
    sections: picker.sections,
    profiles: picker.profiles,
    profileFieldMap: picker.profileFieldMap,
    selectedFieldIds: selectedFieldIds.length ? selectedFieldIds : picker.allFieldIds,
    csrfToken: req.csrfToken()
  });
}

async function renderAdminProfilesPage(req, res, options = {}) {
  const profiles = await listProfiles();
  const editingProfileId = options.editingProfileId || "";
  const editableFields = editingProfileId
    ? await listProfileEditableFields(Number(editingProfileId))
    : [];
  const fieldsForForm = Array.isArray(options.fieldsForForm) ? options.fieldsForForm : editableFields;
  const groupedMap = fieldsForForm.reduce((acc, field) => {
    const section = field.section || "General";
    if (!acc[section]) acc[section] = [];
    acc[section].push(field);
    return acc;
  }, {});
  const sections = Object.keys(groupedMap).map((name) => ({
    name,
    fields: groupedMap[name]
  }));

  res.status(options.statusCode || 200).render("admin-profiles", {
    pageTitle: req.t("admin.profilesTitle"),
    profiles,
    sections,
    editingProfileId,
    formValues: options.formValues || { name: "" },
    newFieldValues: options.newFieldValues || {
      key: "",
      label: "",
      section: options.prefillSection || "",
      field_type: "text",
      unit: "",
      enum_options: "",
      is_required: false,
      has_default: false,
      default_value: ""
    },
    errors: options.errors || {},
    saved: req.query.saved === "1",
    deleted: req.query.deleted === "1",
    csrfToken: req.csrfToken()
  });
}

function renderAdminProfilesAiPage(req, res, options = {}) {
  return res.status(options.statusCode || 200).render("admin-profiles-ai", {
    pageTitle: req.t("admin.profileAiPageTitle"),
    aiProfileTemplate: options.aiProfileTemplate || buildAiProfileJsonTemplate(),
    aiPromptTemplate: options.aiPromptTemplate || "",
    csrfToken: req.csrfToken()
  });
}

async function renderAdminApiKeysPage(req, res, options = {}) {
  const apiKeys = await listApiKeys();
  res.status(options.statusCode || 200).render("admin-api-keys", {
    pageTitle: "API Keys",
    apiKeys,
    formValues: options.formValues || {
      keyName: "",
      keyScopes: "",
      keyTtlDays: ""
    },
    createResult: options.createResult || null,
    deleteResult: options.deleteResult || null,
    csrfToken: req.csrfToken()
  });
}

async function renderAdminTokensPage(req, res, options = {}) {
  const rows = await listEquipments();
  res.status(options.statusCode || 200).render("admin-tokens", {
    pageTitle: req.t("admin.pageTitle"),
    rows,
    saved: req.query.saved === "1",
    tokenStatusSaved: req.query.token_status_saved === "1",
    deleted: req.query.deleted === "1",
    imported: req.query.imported === "1",
    importJsonResult: options.importJsonResult || null,
    importJsonPayload: options.importJsonPayload || "",
    csrfToken: req.csrfToken()
  });
}

function parseModuleSpecJsonInput(raw, fallback) {
  const text = String(raw || "").trim();
  if (!text) return fallback;
  return JSON.parse(text);
}

function renderAdminModuleHubPage(req, res) {
  function resolveModuleStatus(statusKey, fallbackLabel, fallbackVariant) {
    const normalized = String(statusKey || "").trim().toLowerCase();
    if (normalized === "in_development") {
      return { label: "Em desenvolvimento", variant: "warning" };
    }
    if (normalized === "active") {
      return { label: "Ativo", variant: "success" };
    }
    if (normalized === "disabled") {
      return { label: "Desativado", variant: "secondary" };
    }
    return { label: fallbackLabel, variant: fallbackVariant };
  }

  const specflowStatus = resolveModuleStatus(moduleStatuses.specflow, "Ativo", "success");
  const moduleSpecStatus = resolveModuleStatus(moduleStatuses.module_spec, "Em desenvolvimento", "warning");
  const reportServiceStatus = resolveModuleStatus(moduleStatuses.report_service, "Em desenvolvimento", "warning");
  const canAccessSpecflow = hasModuleAccess(req.adminRole, req.adminModuleAccess, "specflow");
  const canAccessModuleSpec = hasModuleAccess(req.adminRole, req.adminModuleAccess, "module-spec");
  const canAccessReportService = hasModuleAccess(req.adminRole, req.adminModuleAccess, "report-service");
  const canAccessSystemMaintenance = Boolean(String(req.adminUsername || "").trim());

  const moduleCards = [
    {
      key: "specflow",
      name: "SpecFlow",
      description: "Formulario principal, configuracoes e fluxo administrativo.",
      status: specflowStatus.label,
      statusVariant: specflowStatus.variant,
      moduleVersion: String(moduleVersions.specflow || "beta"),
      href: env.specflowEnabled && canAccessSpecflow ? "/admin/tokens" : "",
      cta: env.specflowEnabled
        ? (canAccessSpecflow ? "Acessar" : "Sem acesso")
        : "Indisponivel"
    },
    {
      key: "module-spec",
      name: "Module Spec",
      description: "Catalogo tecnico e filtros de selecao por perfil.",
      status: moduleSpecStatus.label,
      statusVariant: moduleSpecStatus.variant,
      moduleVersion: String(moduleVersions.module_spec || "beta"),
      href: env.moduleSpecEnabled && canAccessModuleSpec ? "/admin/module-spec" : "",
      cta: env.moduleSpecEnabled
        ? (canAccessModuleSpec ? "Acessar" : "Sem acesso")
        : "Indisponivel"
    },
    {
      key: "report-service",
      name: "Service Report",
      description: "Base para gerenciamento, historico e entrega de relatorios.",
      status: reportServiceStatus.label,
      statusVariant: reportServiceStatus.variant,
      moduleVersion: String(moduleVersions.report_service || "beta"),
      href: env.reportServiceEnabled && canAccessReportService ? "/admin/report-service" : "",
      cta: env.reportServiceEnabled
        ? (canAccessReportService ? "Acessar" : "Sem acesso")
        : "Indisponivel"
    },
    {
      key: "maintenance-system",
      name: "Manutencao do Sistema",
      description: "Central administrativa. Perfil user acessa apenas senha e tipografia.",
      status: canAccessSystemMaintenance
        ? (String(req.adminRole || "").toLowerCase() === "admin" ? "Ativo" : "Limitado")
        : "Sem acesso",
      statusVariant: canAccessSystemMaintenance
        ? (String(req.adminRole || "").toLowerCase() === "admin" ? "primary" : "warning")
        : "secondary",
      moduleVersion: "admin",
      href: canAccessSystemMaintenance ? "/admin/maintenance/system" : "",
      cta: canAccessSystemMaintenance ? "Acessar" : "Sem acesso"
    }
  ];

  return res.render("admin-module-hub", {
    pageTitle: "Service Hub",
    moduleCards
  });
}

async function renderAdminModuleSpecPage(req, res, options = {}) {
  const [families, models, attributeDefinitions, profiles] = await Promise.all([
    moduleSpecRepo.listFamilies(),
    moduleSpecRepo.listModels(),
    moduleSpecRepo.listAttributeDefinitions(),
    listProfiles()
  ]);

  const editFamilyId = Number(req.query.edit_family || options.editFamilyId || 0);
  const editModelId = Number(req.query.edit_model || options.editModelId || 0);
  const editVariantId = Number(req.query.edit_variant || options.editVariantId || 0);
  const editAttributeId = Number(req.query.edit_attribute || options.editAttributeId || 0);
  const profileId = Number(req.query.profile_id || options.profileId || 0);

  const selectedFamily = Number.isInteger(editFamilyId) && editFamilyId > 0
    ? await moduleSpecRepo.getFamilyById(editFamilyId).catch(() => null)
    : null;
  const selectedModel = Number.isInteger(editModelId) && editModelId > 0
    ? await moduleSpecRepo.getModelById(editModelId).catch(() => null)
    : null;
  const selectedVariant = Number.isInteger(editVariantId) && editVariantId > 0
    ? await moduleSpecRepo.getVariantById(editVariantId).catch(() => null)
    : null;
  const selectedAttribute = Number.isInteger(editAttributeId) && editAttributeId > 0
    ? await moduleSpecRepo.getAttributeDefinitionById(editAttributeId).catch(() => null)
    : null;

  const variants = selectedModel
    ? await moduleSpecRepo.listVariantsByModelId(selectedModel.id).catch(() => [])
    : [];
  const variantAttributes = selectedVariant
    ? await moduleSpecRepo.listVariantAttributes(selectedVariant.id).catch(() => [])
    : [];
  const mappings = Number.isInteger(profileId) && profileId > 0
    ? await moduleSpecRepo.listProfileFilterMappings(profileId).catch(() => [])
    : [];

  return res.status(options.statusCode || 200).render("admin-module-spec", {
    pageTitle: "Module Spec - Filtro de Selecao",
    families,
    models,
    attributeDefinitions,
    profiles,
    selectedFamily,
    selectedModel,
    selectedVariant,
    selectedAttribute,
    variants,
    variantAttributes,
    profileId,
    mappings,
    flags: {
      saved: req.query.saved === "1",
      deleted: req.query.deleted === "1",
      filtered: req.query.filtered === "1"
    },
    flashError: options.flashError || "",
    filterResult: options.filterResult || null,
    formValues: options.formValues || {},
    csrfToken: req.csrfToken()
  });
}

function buildSpecificationRenderModel(specification, submittedValues = {}) {
  return specification.sections.map((section) => ({
    section: section.section,
    fields: section.fields.map((field) => {
      const rawSubmitted = Object.prototype.hasOwnProperty.call(submittedValues, field.id)
        ? submittedValues[field.id]
        : undefined;
      const displayValue = rawSubmitted !== undefined ? rawSubmitted : field.effectiveValue;
      return {
        ...field,
        displayValue: displayValue === null || displayValue === undefined ? "" : displayValue,
        cameFromDefault: rawSubmitted === undefined && field.valueSource === "default"
      };
    })
  }));
}

function parseSpecificationFormBody(fields, body) {
  const values = {};
  const submittedValues = {};
  const errors = {};

  fields.forEach((field) => {
    const key = `field_${field.id}`;
    const raw = body[key];
    const safe = sanitizeInput(raw);
    submittedValues[field.id] = safe;
    try {
      const normalized = validateTypedValue(field, safe, !Boolean(field.isRequired));
      values[field.id] = normalized.hasValue ? normalized.value : "";
    } catch (err) {
      errors[field.id] = err.message;
    }
  });

  return { values, submittedValues, errors };
}

app.get("/", (req, res) => {
  res.redirect("/admin/hub");
});

app.get("/admin/login", csrfProtection, (req, res) => {
  if (isValidAdminSessionToken(req.cookies[ADMIN_SESSION_COOKIE_NAME])) {
    return res.redirect("/admin/hub");
  }
  res.render("admin-login", {
    pageTitle: req.t("admin.loginTitle"),
    loginRateLimited: req.query.rate === "1",
    invalidCredentials: req.query.error === "1",
    csrfToken: req.csrfToken()
  });
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.redirect("/admin/login?rate=1")
});

app.post("/admin/login", csrfProtection, adminLoginLimiter, asyncHandler(async (req, res) => {
  const username = sanitizeInput(req.body.username);
  const password = sanitizeInput(req.body.password);

  const isPrimaryAdmin = safeTimingEqual(username, String(env.admin.user || "").trim()) && safeTimingEqual(password, env.admin.pass);
  const registeredAdmin = isPrimaryAdmin ? null : await verifyAdminUserCredentials(username, password);
  if (!isPrimaryAdmin && !registeredAdmin) {
    return res.redirect("/admin/login?error=1");
  }

  const authenticatedUsername = isPrimaryAdmin ? env.admin.user : registeredAdmin.username;
  res.cookie(ADMIN_SESSION_COOKIE_NAME, createAdminSessionToken(authenticatedUsername), {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookies(req),
    maxAge: ADMIN_SESSION_TTL_MS,
    path: "/"
  });
  return res.redirect("/admin/hub");
}));

app.post("/admin/logout", csrfProtection, (req, res) => {
  res.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookies(req),
    path: "/"
  });
  return res.redirect("/admin/login");
});

const requireSpecflowModuleAccess = requireModuleAccess("specflow");
const requireModuleSpecModuleAccess = requireModuleAccess("module-spec");
const requireReportServiceModuleAccess = requireModuleAccess("report-service");
const requireSpecflowEnabled = (req, res, next) => (env.specflowEnabled ? next() : sendStandardError(req, res, 404));
const requireModuleSpecEnabled = (req, res, next) => (env.moduleSpecEnabled ? next() : sendStandardError(req, res, 404));
const requireReportServiceEnabled = (req, res, next) => (env.reportServiceEnabled ? next() : sendStandardError(req, res, 404));

app.use("/admin/tokens", requireSpecflowEnabled, requireAdminAuth, requireSpecflowModuleAccess);
app.use("/admin/profiles", requireSpecflowEnabled, requireAdminAuth, requireSpecflowModuleAccess);
app.use("/admin/clients", requireSpecflowEnabled, requireAdminAuth, requireSpecflowModuleAccess);
app.use("/admin/fields", requireSpecflowEnabled, requireAdminAuth, requireSpecflowModuleAccess);
app.use("/admin/seed-annexd", requireSpecflowEnabled, requireAdminAuth, requireSpecflowModuleAccess);
app.use("/admin/module-spec", requireModuleSpecEnabled, requireAdminAuth, requireModuleSpecModuleAccess);
app.use("/admin/report-service", requireReportServiceEnabled, requireAdminAuth, requireReportServiceModuleAccess);
app.use("/service-report", requireReportServiceEnabled, requireAdminAuth, requireReportServiceModuleAccess);
app.use("/admin/maintenance/module-spec", requireModuleSpecEnabled, requireAdminAuth, requireModuleSpecModuleAccess);
app.use("/admin/maintenance/report-service", requireReportServiceEnabled, requireAdminAuth, requireReportServiceModuleAccess);

app.get("/admin/hub", csrfProtection, requireAdminAuth, (req, res) => {
  renderAdminModuleHubPage(req, res);
});

app.get("/admin/tokens", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  await renderAdminTokensPage(req, res);
}));

app.post("/admin/tokens/import-json", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const rawPayload = String(req.body.json_payload || "");
  const importAction = sanitizeInput(req.body.import_action || "inspect").toLowerCase();

  let imported;
  try {
    imported = parseImportedSubmissionPayload(rawPayload);
  } catch (_err) {
    await renderAdminTokensPage(req, res, {
      statusCode: 422,
      importJsonPayload: rawPayload,
      importJsonResult: {
        status: "error",
        message: req.t("admin.tokenImportInvalid")
      }
    });
    return;
  }

  const existingEquipment = imported.token ? await getEquipmentByToken(imported.token) : null;

  if (importAction === "apply_existing") {
    if (!existingEquipment) {
      await renderAdminTokensPage(req, res, {
        statusCode: 404,
        importJsonPayload: rawPayload,
        importJsonResult: {
          status: "missing",
          token: imported.token,
          message: req.t("admin.tokenImportTokenMissing", { token: imported.token || "-" }),
          canCreate: true
        }
      });
      return;
    }

    const enabledFieldIds = Array.isArray(imported.configuration.enabledFieldIds)
      ? imported.configuration.enabledFieldIds
      : await getEnabledFieldIdsForEquipment(existingEquipment.id);

    await updateEquipmentConfiguration(existingEquipment.id, {
      ...imported.clientData,
      profileId: imported.configuration.profileId,
      enabledFieldIds
    });
    await saveEquipmentSpecification(existingEquipment.id, imported.values);
    return res.redirect(`/form/${existingEquipment.token}/specification?imported=1`);
  }

  if (importAction === "create_new") {
    const created = await createEquipment({
      ...imported.clientData,
      profileId: imported.configuration.profileId,
      enabledFieldIds: imported.configuration.enabledFieldIds
    });
    await saveEquipmentSpecification(created.id, imported.values);
    return res.redirect(`/form/${created.token}/specification?imported=1`);
  }

  if (existingEquipment) {
    await renderAdminTokensPage(req, res, {
      importJsonPayload: rawPayload,
      importJsonResult: {
        status: "found",
        token: existingEquipment.token,
        message: req.t("admin.tokenImportTokenFound", { token: existingEquipment.token }),
        reviewUrl: `/form/${existingEquipment.token}/review`,
        editUrl: `/form/${existingEquipment.token}/specification`
      }
    });
    return;
  }

  await renderAdminTokensPage(req, res, {
    importJsonPayload: rawPayload,
    importJsonResult: {
      status: "missing",
      token: imported.token,
      message: req.t("admin.tokenImportTokenMissing", { token: imported.token || "-" }),
      canCreate: true
    }
  });
}));

app.get("/admin/public-token-links", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  await renderAdminPublicTokenLinksPage(req, res);
}));

app.post("/admin/public-token-links/create", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const profileIdRaw = sanitizeInput(req.body.profile_id);
  const profileId = Number(profileIdRaw);
  const formValues = { profile_id: profileIdRaw };
  const formErrors = {};

  if (!Number.isInteger(profileId) || profileId <= 0) {
    formErrors.profile_id = req.t("admin.invalidId");
  } else {
    const profile = await getProfileById(profileId);
    if (!profile) {
      formErrors.profile_id = req.t("admin.invalidId");
    }
  }

  if (Object.keys(formErrors).length > 0) {
    await renderAdminPublicTokenLinksPage(req, res, {
      statusCode: 422,
      formValues,
      formErrors
    });
    return;
  }

  await createPublicTokenLink(profileId);
  return res.redirect("/admin/public-token-links?created=1");
}));

app.post("/admin/public-token-links/:id/toggle", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const id = Number(sanitizeInput(req.params.id));
  const link = await getPublicTokenLinkById(id);
  if (!link) {
    return sendStandardError(req, res, 404);
  }

  await setPublicTokenLinkActive(link.id, !link.isActive);
  return res.redirect("/admin/public-token-links?toggled=1");
}));

app.post("/admin/public-token-links/:id/delete", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const id = Number(sanitizeInput(req.params.id));
  const deleted = await deletePublicTokenLinkById(id);
  if (!deleted) {
    return sendStandardError(req, res, 404);
  }

  return res.redirect("/admin/public-token-links?deleted=1");
}));

app.get("/admin/maintenance/system", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  await renderSystemMaintenancePage(req, res);
}));

app.post("/admin/maintenance/system/font", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const requestedFont = sanitizeInput(req.body.system_font);
  const adminUsername = String(req.adminUsername || "").trim();
  const adminUser = await getAdminUserByUsername(adminUsername);
  let systemFontResult;
  let statusCode = 200;

  if (!adminUser) {
    statusCode = 422;
    systemFontResult = {
      ok: false,
      message: "Seu usuario nao esta cadastrado em admin_users. Solicite ao admin a regularizacao da conta."
    };
  } else {
    try {
      const saved = await setUserSystemFontKey(adminUsername, requestedFont);
      systemFontResult = {
        ok: true,
        message: `Fonte aplicada para o usuario ${adminUsername}: ${saved}.`
      };
    } catch (err) {
      statusCode = 422;
      systemFontResult = {
        ok: false,
        message: sanitizeInput(err?.message || "") || "Falha ao salvar fonte do usuario."
      };
    }
  }

  await renderSystemMaintenancePage(req, res, {
    statusCode,
    systemFontResult
  });
}));

app.post("/admin/maintenance/system/password", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const adminUsername = String(req.adminUsername || "").trim();
  const adminUser = await getAdminUserByUsername(adminUsername);
  const currentPassword = sanitizeInput(req.body.current_password);
  const newPassword = sanitizeInput(req.body.new_password);
  const newPasswordConfirm = sanitizeInput(req.body.new_password_confirm);
  let selfPasswordResult;
  let statusCode = 200;

  if (!adminUser) {
    statusCode = 422;
    selfPasswordResult = { ok: false, message: "Seu usuario nao esta cadastrado em admin_users para troca de senha." };
  } else if (!currentPassword) {
    statusCode = 422;
    selfPasswordResult = { ok: false, message: "Informe a senha atual." };
  } else if (!newPassword || String(newPassword).length < 8) {
    statusCode = 422;
    selfPasswordResult = { ok: false, message: "Nova senha deve ter ao menos 8 caracteres." };
  } else if (!safeTimingEqual(String(newPassword), String(newPasswordConfirm))) {
    statusCode = 422;
    selfPasswordResult = { ok: false, message: "Confirmacao de senha nao confere." };
  } else {
    try {
      await changeAdminUserPasswordByUsername({
        username: adminUsername,
        currentPassword,
        newPassword
      });
      selfPasswordResult = { ok: true, message: "Senha atualizada com sucesso." };
    } catch (err) {
      statusCode = 422;
      selfPasswordResult = {
        ok: false,
        message: sanitizeInput(err?.message || "") || "Falha ao atualizar senha."
      };
    }
  }

  await renderSystemMaintenancePage(req, res, {
    statusCode,
    selfPasswordResult
  });
}));

app.post("/admin/maintenance/system/command", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const action = sanitizeInput(req.body.action);
  const backupIdRaw = sanitizeInput(req.body.backupId);
  const backupId = Number(backupIdRaw);
  let label = "";
  let execution = { ok: false, code: -1, output: "Acao invalida." };
  let downloadPath = "";

  if (action === "backup_all") {
    label = "node scripts/backup-module-database.js all";
    execution = await runNodeScripts([{ script: "scripts/backup-module-database.js", args: ["all"] }]);
  } else if (action === "migrate_all") {
    label = "npm run db:migrate + npm run db:migrate:config + npm run db:migrate:module-spec + npm run db:migrate:report-service";
    execution = await runNodeScripts([
      { script: "scripts/migrate.js" },
      { script: "configdb/migrate.js" },
      { script: "module_spec/migrate.js" },
      { script: "report_service/migrate.js" }
    ]);
  } else if (action === "seed_all") {
    label = "npm run db:seed";
    execution = await runNodeScripts([{ script: "scripts/seed.js" }]);
  } else if (action === "admin_sessions_clear") {
    label = "npm run admin:sessions:clear";
    execution = await runNodeScripts([{ script: "scripts/clear-admin-sessions.js" }]);
  } else if (action === "db_backup") {
    label = "npm run db:backup:specflow";
    execution = await runNodeScripts([{ script: "scripts/backup-module-database.js", args: ["specflow"] }]);
    if (execution.ok) {
      const outputFileName = extractBackupFileNameFromOutput(execution.output);
      const backups = await loadBackupsForMaintenancePage();
      const matched = backups.find((item) => item.fileName === outputFileName) || backups[0];
      downloadPath = buildAdminBackupDownloadPath(matched ? matched.id : null);
    }
  } else if (action === "db_restore_selected") {
    if (!Number.isInteger(backupId) || backupId <= 0) {
      execution = { ok: false, code: -1, output: "Informe backupId valido." };
      label = "npm run db:restore-database -- <arquivo.sql>";
    } else {
      const selectedBackup = await getBackupFileById(backupId);
      if (!selectedBackup) {
        execution = { ok: false, code: -1, output: "Backup nao encontrado no catalogo." };
        label = "npm run db:restore-database -- <arquivo.sql>";
      } else if (!selectedBackup.existsOnDisk) {
        execution = { ok: false, code: -1, output: `Arquivo nao encontrado no disco: ${selectedBackup.filePath}` };
        label = `npm run db:restore-database -- "${selectedBackup.filePath}"`;
      } else {
        const restoreCommand = buildRestoreScriptArgs(selectedBackup.filePath);
        label = restoreCommand.moduleName
          ? `npm run db:restore-database -- --module=${restoreCommand.moduleName} "${selectedBackup.filePath}"`
          : `npm run db:restore-database -- "${selectedBackup.filePath}"`;
        execution = await runNodeScripts([{ script: "scripts/restore-database.js", args: restoreCommand.args }]);
      }
    }
  } else if (action === "db_delete_selected") {
    if (!Number.isInteger(backupId) || backupId <= 0) {
      execution = { ok: false, code: -1, output: "Informe backupId valido." };
      label = "Excluir backup do catalogo/disco por ID";
    } else {
      const deleted = await deleteBackupFileById(backupId, { removeFromDisk: true });
      if (!deleted) {
        execution = { ok: false, code: -1, output: "Backup nao encontrado no catalogo." };
        label = "Excluir backup do catalogo/disco por ID";
      } else {
        label = `Excluir backup ID ${backupId}`;
        const diskMessage = deleted.diskStatus === "deleted"
          ? "Arquivo removido do disco."
          : "Arquivo ja nao existia no disco.";
        execution = {
          ok: true,
          code: 0,
          output: `Backup removido do catalogo.\n${diskMessage}\nArquivo: ${deleted.backup.filePath}`
        };
      }
    }
  } else if (action === "db_restore") {
    const backups = await loadBackupsForMaintenancePage();
    const latest = backups.find((item) => item.existsOnDisk);
    if (!latest) {
      execution = { ok: false, code: -1, output: "Nenhum backup disponivel para restore." };
      label = "npm run db:restore-database -- <arquivo.sql>";
    } else {
      const restoreCommand = buildRestoreScriptArgs(latest.filePath);
      label = restoreCommand.moduleName
        ? `npm run db:restore-database -- --module=${restoreCommand.moduleName} "${latest.filePath}"`
        : `npm run db:restore-database -- "${latest.filePath}"`;
      execution = await runNodeScripts([{ script: "scripts/restore-database.js", args: restoreCommand.args }]);
    }
  }

  await renderSystemMaintenancePage(req, res, {
    statusCode: execution.ok ? 200 : 422,
    commandResult: {
      ...execution,
      label,
      downloadPath
    }
  });
}));

app.get("/admin/maintenance", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  await renderAdminMaintenancePage(req, res);
}));

app.get("/admin/maintenance/specflow", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  await renderAdminMaintenancePage(req, res);
}));

app.get("/admin/maintenance/module-spec", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  renderModuleSpecMaintenancePage(req, res);
}));

app.post("/admin/maintenance/module-spec/command", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const action = sanitizeInput(req.body.action);
  let label = "";
  let execution = { ok: false, code: -1, output: "Acao invalida." };

  if (action === "db_backup") {
    label = "node scripts/backup-module-database.js module-spec";
    execution = await runNodeScripts([{ script: "scripts/backup-module-database.js", args: ["module-spec"] }]);
  } else if (action === "db_reset") {
    label = "reset module-spec schema + seed";
    execution = await runNodeScripts([
      { script: "scripts/reset-module-db-schema.js", args: ["module-spec"] },
      { script: "module_spec/seed.js" }
    ]);
  }

  renderModuleSpecMaintenancePage(req, res, {
    statusCode: execution.ok ? 200 : 422,
    commandResult: {
      ...execution,
      label
    }
  });
}));

app.get("/admin/maintenance/report-service", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  await renderReportServiceMaintenancePage(req, res);
}));

app.post("/admin/maintenance/report-service/command", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const action = sanitizeInput(req.body.action);
  let label = "";
  let execution = { ok: false, code: -1, output: "Acao invalida." };

  if (action === "db_backup") {
    label = "node scripts/backup-module-database.js report-service";
    execution = await runNodeScripts([{ script: "scripts/backup-module-database.js", args: ["report-service"] }]);
  } else if (action === "db_reset") {
    label = "reset report-service schema + seed";
    execution = await runNodeScripts([
      { script: "scripts/reset-module-db-schema.js", args: ["report-service"] },
      { script: "report_service/seed.js" }
    ]);
  }

  await renderReportServiceMaintenancePage(req, res, {
    statusCode: execution.ok ? 200 : 422,
    commandResult: {
      ...execution,
      label
    }
  });
}));

app.post("/admin/maintenance/report-service/email-templates/save", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateId = sanitizeInput(req.body.template_id);
  const templateName = sanitizeInput(req.body.template_name);
  const templateSubject = sanitizeInput(req.body.template_subject);
  const templateHtml = String(req.body.template_html || "").slice(0, 120000);
  const templatePurpose = sanitizeInput(req.body.template_purpose) || "general";
  const setDefaultTemplate = parseBooleanInput(req.body.set_default_template) === true;
  const emailTemplateEditorValues = {
    template_id: templateId,
    template_name: templateName,
    template_subject: templateSubject,
    template_html: templateHtml,
    template_purpose: templatePurpose,
    set_default_template: setDefaultTemplate
  };

  let emailTemplatesUpdateResult;
  try {
    const saved = await saveReportServiceEmailHtmlTemplate({
      templateId,
      name: templateName,
      subject: templateSubject,
      html: templateHtml,
      purpose: templatePurpose,
      setAsDefault: setDefaultTemplate
    });
    emailTemplatesUpdateResult = {
      ok: true,
      message: `Modelo HTML salvo com sucesso: ${saved.name}.`
    };
    emailTemplateEditorValues.template_id = saved.id;
  } catch (err) {
    emailTemplatesUpdateResult = {
      ok: false,
      message: sanitizeInput(err?.message || "") || getStandardStatusMessage(req, 500)
    };
  }

  const emailSettings = await getReportServiceEmailSettings();
  await renderReportServiceMaintenancePage(req, res, {
    statusCode: emailTemplatesUpdateResult.ok ? 200 : 422,
    emailTemplatesUpdateResult,
    emailTemplateEditorValues,
    emailSettings
  });
}));

app.post("/admin/maintenance/report-service/email-templates/default", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateId = sanitizeInput(req.body.template_id);
  let emailTemplatesUpdateResult;

  try {
    await setDefaultReportServiceEmailHtmlTemplate(templateId);
    emailTemplatesUpdateResult = { ok: true, message: "Modelo padrao atualizado com sucesso." };
  } catch (err) {
    emailTemplatesUpdateResult = {
      ok: false,
      message: sanitizeInput(err?.message || "") || getStandardStatusMessage(req, 500)
    };
  }

  const emailSettings = await getReportServiceEmailSettings();
  await renderReportServiceMaintenancePage(req, res, {
    statusCode: emailTemplatesUpdateResult.ok ? 200 : 422,
    emailTemplatesUpdateResult,
    emailSettings
  });
}));

app.post("/admin/maintenance/report-service/email-templates/:id/delete", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateId = sanitizeInput(req.params.id);
  let emailTemplatesUpdateResult;

  try {
    await deleteReportServiceEmailHtmlTemplate(templateId);
    emailTemplatesUpdateResult = { ok: true, message: "Modelo HTML removido com sucesso." };
  } catch (err) {
    emailTemplatesUpdateResult = {
      ok: false,
      message: sanitizeInput(err?.message || "") || getStandardStatusMessage(req, 500)
    };
  }

  const emailSettings = await getReportServiceEmailSettings();
  await renderReportServiceMaintenancePage(req, res, {
    statusCode: emailTemplatesUpdateResult.ok ? 200 : 422,
    emailTemplatesUpdateResult,
    emailSettings
  });
}));

app.post("/admin/maintenance/report-service/default-recipients", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const defaultRecipientsRaw = String(req.body.default_email_recipients || "").slice(0, 4000).trim();
  const parsedRecipients = parseEmailListInput(defaultRecipientsRaw.replace(/\r?\n/g, ";"));
  const invalidEmail = parsedRecipients.find((email) => !isValidEmailAddress(email));

  let defaultRecipientsUpdateResult;
  if (invalidEmail) {
    defaultRecipientsUpdateResult = { ok: false, message: `E-mail invalido na lista de destinatarios padrao: ${invalidEmail}` };
  } else {
    try {
      await saveReportServiceEmailDefaultRecipients(parsedRecipients.join("; "));
      defaultRecipientsUpdateResult = { ok: true, message: "Destinatarios padrao atualizados com sucesso." };
    } catch (_err) {
      defaultRecipientsUpdateResult = { ok: false, message: getStandardStatusMessage(req, 500) };
    }
  }

  const emailSettings = await getReportServiceEmailSettings();
  await renderReportServiceMaintenancePage(req, res, {
    statusCode: defaultRecipientsUpdateResult.ok ? 200 : 422,
    defaultRecipientsUpdateResult,
    emailSettings
  });
}));

app.post("/admin/maintenance/report-service/smtp", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const smtpHost = sanitizeInput(req.body.smtp_host);
  const smtpPortRaw = sanitizeInput(req.body.smtp_port);
  const smtpSecure = parseBooleanInput(req.body.smtp_secure) === true;
  const smtpUser = sanitizeInput(req.body.smtp_user);
  const smtpFrom = sanitizeInput(req.body.smtp_from);
  const smtpPass = sanitizeInput(req.body.smtp_pass);
  const clearPassword = parseBooleanInput(req.body.smtp_pass_clear) === true;
  const smtpPort = Number(smtpPortRaw);

  let smtpUpdateResult;
  if (!smtpHost) {
    smtpUpdateResult = { ok: false, message: "Informe o host SMTP." };
  } else if (!Number.isInteger(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
    smtpUpdateResult = { ok: false, message: "Porta SMTP invalida." };
  } else if (!smtpFrom || !isValidEmailAddress(smtpFrom)) {
    smtpUpdateResult = { ok: false, message: "Informe um remetente valido em SMTP From." };
  } else {
    try {
      await saveReportServiceSmtpSettings({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        user: smtpUser,
        from: smtpFrom,
        pass: smtpPass,
        passwordProvided: Boolean(smtpPass),
        clearPassword
      });
      smtpUpdateResult = { ok: true, message: "Configuracao SMTP atualizada com sucesso." };
    } catch (_err) {
      smtpUpdateResult = { ok: false, message: getStandardStatusMessage(req, 500) };
    }
  }

  await renderReportServiceMaintenancePage(req, res, {
    statusCode: smtpUpdateResult.ok ? 200 : 422,
    smtpUpdateResult
  });
}));

app.post("/admin/maintenance/email-templates/save", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateId = sanitizeInput(req.body.template_id);
  const templateName = sanitizeInput(req.body.template_name);
  const templateSubject = sanitizeInput(req.body.template_subject);
  const templateHtml = String(req.body.template_html || "").slice(0, 120000);
  const setDefaultTemplate = parseBooleanInput(req.body.set_default_template) === true;
  const emailTemplateEditorValues = {
    template_id: templateId,
    template_name: templateName,
    template_subject: templateSubject,
    template_html: templateHtml,
    set_default_template: setDefaultTemplate
  };

  let emailTemplatesUpdateResult;
  try {
    const saved = await saveEmailHtmlTemplate({
      templateId,
      name: templateName,
      subject: templateSubject,
      html: templateHtml,
      setAsDefault: setDefaultTemplate
    });
    emailTemplatesUpdateResult = {
      ok: true,
      message: `Modelo HTML salvo com sucesso: ${saved.name}.`
    };
    emailTemplateEditorValues.template_id = saved.id;
  } catch (err) {
    emailTemplatesUpdateResult = {
      ok: false,
      message: sanitizeInput(err?.message || "") || getStandardStatusMessage(req, 500)
    };
  }

  const emailSettings = await getEmailSettings();
  return renderAdminMaintenancePage(req, res, {
    statusCode: emailTemplatesUpdateResult.ok ? 200 : 422,
    emailTemplatesUpdateResult,
    emailTemplateEditorValues,
    emailSettings
  });
}));

app.post("/admin/maintenance/email-templates/default", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateId = sanitizeInput(req.body.template_id);
  let emailTemplatesUpdateResult;

  try {
    await setDefaultEmailHtmlTemplate(templateId);
    emailTemplatesUpdateResult = { ok: true, message: "Modelo padrao atualizado com sucesso." };
  } catch (err) {
    emailTemplatesUpdateResult = {
      ok: false,
      message: sanitizeInput(err?.message || "") || getStandardStatusMessage(req, 500)
    };
  }

  const emailSettings = await getEmailSettings();
  return renderAdminMaintenancePage(req, res, {
    statusCode: emailTemplatesUpdateResult.ok ? 200 : 422,
    emailTemplatesUpdateResult,
    emailSettings
  });
}));

app.post("/admin/maintenance/email-templates/:id/delete", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateId = sanitizeInput(req.params.id);
  let emailTemplatesUpdateResult;

  try {
    await deleteEmailHtmlTemplate(templateId);
    emailTemplatesUpdateResult = { ok: true, message: "Modelo HTML removido com sucesso." };
  } catch (err) {
    emailTemplatesUpdateResult = {
      ok: false,
      message: sanitizeInput(err?.message || "") || getStandardStatusMessage(req, 500)
    };
  }

  const emailSettings = await getEmailSettings();
  return renderAdminMaintenancePage(req, res, {
    statusCode: emailTemplatesUpdateResult.ok ? 200 : 422,
    emailTemplatesUpdateResult,
    emailSettings
  });
}));

app.post("/admin/maintenance/pdf-templates/save", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateId = sanitizeInput(req.body.template_id);
  const templateName = sanitizeInput(req.body.template_name);
  const templateTheme = normalizePdfTheme(sanitizeInput(req.body.template_theme));
  const palette = normalizePdfPalette(templateTheme, {
    cardBackground: sanitizeInput(req.body.card_background),
    borderColor: sanitizeInput(req.body.border_color),
    titleColor: sanitizeInput(req.body.title_color),
    headerColor: sanitizeInput(req.body.header_color),
    textColor: sanitizeInput(req.body.text_color),
    rowEvenBackground: sanitizeInput(req.body.row_even_background),
    rowOddBackground: sanitizeInput(req.body.row_odd_background),
    lineColor: sanitizeInput(req.body.line_color),
    badgeBackground: sanitizeInput(req.body.badge_background),
    badgeBorder: sanitizeInput(req.body.badge_border),
    badgeText: sanitizeInput(req.body.badge_text)
  });
  const pdfTemplateEditorValues = {
    template_id: templateId,
    template_name: templateName,
    template_theme: templateTheme,
    card_background: palette.cardBackground,
    border_color: palette.borderColor,
    title_color: palette.titleColor,
    header_color: palette.headerColor,
    text_color: palette.textColor,
    row_even_background: palette.rowEvenBackground,
    row_odd_background: palette.rowOddBackground,
    line_color: palette.lineColor,
    badge_background: palette.badgeBackground,
    badge_border: palette.badgeBorder,
    badge_text: palette.badgeText
  };

  let pdfTemplateUpdateResult;
  try {
    const saved = await savePdfTemplate({
      templateId,
      name: templateName,
      theme: templateTheme,
      palette
    });
    pdfTemplateUpdateResult = {
      ok: true,
      message: `Template PDF salvo com sucesso: ${saved.name}.`
    };
    pdfTemplateEditorValues.template_id = saved.id;
  } catch (err) {
    pdfTemplateUpdateResult = {
      ok: false,
      message: sanitizeInput(err?.message || "") || getStandardStatusMessage(req, 500)
    };
  }

  const emailSettings = await getEmailSettings();
  const pdfTemplateSettings = await getPdfTemplateSettings();
  return renderAdminMaintenancePage(req, res, {
    statusCode: pdfTemplateUpdateResult.ok ? 200 : 422,
    pdfTemplateUpdateResult,
    pdfTemplateEditorValues,
    emailSettings,
    pdfTemplateSettings
  });
}));

app.post("/admin/maintenance/pdf-templates/preview", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateTheme = normalizePdfTheme(sanitizeInput(req.body.template_theme));
  const templateName = sanitizeInput(req.body.template_name) || "Preview";
  const palette = normalizePdfPalette(templateTheme, {
    cardBackground: sanitizeInput(req.body.card_background),
    borderColor: sanitizeInput(req.body.border_color),
    titleColor: sanitizeInput(req.body.title_color),
    headerColor: sanitizeInput(req.body.header_color),
    textColor: sanitizeInput(req.body.text_color),
    rowEvenBackground: sanitizeInput(req.body.row_even_background),
    rowOddBackground: sanitizeInput(req.body.row_odd_background),
    lineColor: sanitizeInput(req.body.line_color),
    badgeBackground: sanitizeInput(req.body.badge_background),
    badgeBorder: sanitizeInput(req.body.badge_border),
    badgeText: sanitizeInput(req.body.badge_text)
  });
  const pdfTemplate = {
    id: "preview",
    name: templateName,
    theme: templateTheme,
    palette
  };
  const mock = buildPdfPreviewMockData(req.lang);
  const pdfBuffer = await generatePdfBuffer({
    submission: mock.submission,
    sections: mock.sections,
    documents: mock.documents,
    lang: req.lang,
    theme: templateTheme,
    pdfTemplate
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline; filename=preview-template-specflow.pdf");
  res.send(pdfBuffer);
}));

app.post("/admin/maintenance/pdf-templates/default", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateId = sanitizeInput(req.body.template_id);
  const theme = normalizePdfTheme(sanitizeInput(req.body.theme));
  let pdfTemplateDefaultResult;
  try {
    await setDefaultPdfTemplateForTheme({ templateId, theme });
    pdfTemplateDefaultResult = { ok: true, message: `Template padrao do tema ${theme} atualizado com sucesso.` };
  } catch (err) {
    pdfTemplateDefaultResult = {
      ok: false,
      message: sanitizeInput(err?.message || "") || getStandardStatusMessage(req, 500)
    };
  }

  const emailSettings = await getEmailSettings();
  const pdfTemplateSettings = await getPdfTemplateSettings();
  return renderAdminMaintenancePage(req, res, {
    statusCode: pdfTemplateDefaultResult.ok ? 200 : 422,
    pdfTemplateDefaultResult,
    emailSettings,
    pdfTemplateSettings
  });
}));

app.post("/admin/maintenance/pdf-templates/:id/delete", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const templateId = sanitizeInput(req.params.id);
  let pdfTemplateUpdateResult;
  try {
    await deletePdfTemplate(templateId);
    pdfTemplateUpdateResult = { ok: true, message: "Template PDF removido com sucesso." };
  } catch (err) {
    pdfTemplateUpdateResult = {
      ok: false,
      message: sanitizeInput(err?.message || "") || getStandardStatusMessage(req, 500)
    };
  }

  const emailSettings = await getEmailSettings();
  const pdfTemplateSettings = await getPdfTemplateSettings();
  return renderAdminMaintenancePage(req, res, {
    statusCode: pdfTemplateUpdateResult.ok ? 200 : 422,
    pdfTemplateUpdateResult,
    emailSettings,
    pdfTemplateSettings
  });
}));

app.post("/admin/maintenance/default-recipients", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const defaultRecipientsRaw = String(req.body.default_email_recipients || "").slice(0, 4000).trim();
  const parsedRecipients = parseEmailListInput(defaultRecipientsRaw.replace(/\r?\n/g, ";"));
  const invalidEmail = parsedRecipients.find((email) => !isValidEmailAddress(email));

  let defaultRecipientsUpdateResult;
  if (invalidEmail) {
    defaultRecipientsUpdateResult = { ok: false, message: `E-mail invalido na lista de destinatarios padrao: ${invalidEmail}` };
  } else {
    try {
      await saveEmailDefaultRecipients(parsedRecipients.join("; "));
      defaultRecipientsUpdateResult = { ok: true, message: "Destinatarios padrao atualizados com sucesso." };
    } catch (_err) {
      defaultRecipientsUpdateResult = { ok: false, message: getStandardStatusMessage(req, 500) };
    }
  }

  const emailSettings = await getEmailSettings();
  return renderAdminMaintenancePage(req, res, {
    statusCode: defaultRecipientsUpdateResult.ok ? 200 : 422,
    defaultRecipientsUpdateResult,
    emailSettings
  });
}));

app.post("/admin/maintenance/smtp", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const smtpHost = sanitizeInput(req.body.smtp_host);
  const smtpPortRaw = sanitizeInput(req.body.smtp_port);
  const smtpSecure = parseBooleanInput(req.body.smtp_secure) === true;
  const smtpUser = sanitizeInput(req.body.smtp_user);
  const smtpFrom = sanitizeInput(req.body.smtp_from);
  const smtpPass = sanitizeInput(req.body.smtp_pass);
  const clearPassword = parseBooleanInput(req.body.smtp_pass_clear) === true;
  const smtpPort = Number(smtpPortRaw);

  let smtpUpdateResult;
  if (!smtpHost) {
    smtpUpdateResult = { ok: false, message: "Informe o host SMTP." };
  } else if (!Number.isInteger(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
    smtpUpdateResult = { ok: false, message: "Porta SMTP invalida." };
  } else if (!smtpFrom || !isValidEmailAddress(smtpFrom)) {
    smtpUpdateResult = { ok: false, message: "Informe um remetente valido em SMTP From." };
  } else {
    try {
      await saveSmtpSettings({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        user: smtpUser,
        from: smtpFrom,
        pass: smtpPass,
        passwordProvided: Boolean(smtpPass),
        clearPassword
      });
      smtpUpdateResult = { ok: true, message: "Configuracao SMTP atualizada com sucesso." };
    } catch (_err) {
      smtpUpdateResult = { ok: false, message: getStandardStatusMessage(req, 500) };
    }
  }

  await renderAdminMaintenancePage(req, res, {
    statusCode: smtpUpdateResult.ok ? 200 : 422,
    smtpUpdateResult
  });
}));

app.post("/admin/maintenance/smtp/test", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const testEmailTo = sanitizeInput(req.body.test_email_to);
  let smtpTestResult;

  if (!testEmailTo || !isValidEmailAddress(testEmailTo)) {
    smtpTestResult = { ok: false, message: "Informe um e-mail valido para teste." };
  } else {
    try {
      const info = await sendSmtpTestEmail({ to: testEmailTo });
      const messageId = sanitizeInput(info?.messageId || "");
      smtpTestResult = {
        ok: true,
        message: messageId
          ? `E-mail de teste enviado com sucesso. Message-ID: ${messageId}`
          : "E-mail de teste enviado com sucesso."
      };
    } catch (err) {
      const detail = sanitizeInput(err?.message || "");
      smtpTestResult = {
        ok: false,
        message: detail ? `Falha ao enviar teste SMTP: ${detail}` : "Falha ao enviar teste SMTP."
      };
    }
  }

  await renderAdminMaintenancePage(req, res, {
    statusCode: smtpTestResult.ok ? 200 : 422,
    smtpTestResult,
    maintenanceEmailTestTo: testEmailTo
  });
}));

app.get("/admin/api-keys", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  await renderAdminApiKeysPage(req, res);
}));

app.post("/admin/api-keys/create", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const keyName = sanitizeInput(req.body.keyName);
  const keyScopesRaw = sanitizeInput(req.body.keyScopes);
  const keyTtlDaysRaw = sanitizeInput(req.body.keyTtlDays);
  const keyTtlDays = Number(keyTtlDaysRaw);
  const formValues = {
    keyName,
    keyScopes: keyScopesRaw,
    keyTtlDays: keyTtlDaysRaw
  };

  try {
    const scopes = parseApiKeyScopes(keyScopesRaw);
    const expiresAt = Number.isInteger(keyTtlDays) && keyTtlDays > 0
      ? new Date(Date.now() + keyTtlDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const created = await createApiKey({ name: keyName, scopes, expiresAt });
    await renderAdminApiKeysPage(req, res, {
      createResult: {
        ok: true,
        message: `API key criada com sucesso: id=${created.record.id}, prefix=${created.record.keyPrefix}`,
        key: created.key
      },
      formValues: {
        keyName: "",
        keyScopes: keyScopesRaw,
        keyTtlDays: ""
      }
    });
  } catch (err) {
    await renderAdminApiKeysPage(req, res, {
      statusCode: 422,
      createResult: {
        ok: false,
        message: err.message || "Falha ao criar API key.",
        key: ""
      },
      formValues
    });
  }
}));

app.post("/admin/api-keys/:id/delete", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  let deleteResult;
  try {
    if (!Number.isInteger(id) || id <= 0) {
      deleteResult = { ok: false, message: "ID de API key invalido." };
    } else {
      const deleted = await deleteApiKey(id);
      if (!deleted) {
        deleteResult = { ok: false, message: "API key nao encontrada." };
      } else {
        deleteResult = { ok: true, message: `API key removida: id=${deleted.id}, name=${deleted.name}` };
      }
    }
  } catch (err) {
    deleteResult = { ok: false, message: err.message || "Falha ao deletar API key." };
  }
  await renderAdminApiKeysPage(req, res, { deleteResult });
}));

app.post("/admin/maintenance/command", csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const action = sanitizeInput(req.body.action);
  const token = sanitizeInput(req.body.token);
  const backupIdRaw = sanitizeInput(req.body.backupId);
  const backupId = Number(backupIdRaw);
  let label = "";
  let execution = { ok: false, code: -1, output: "Acao invalida." };
  let downloadPath = "";

  if (action === "db_reseed") {
    label = "npm run db:reseed";
    execution = await runNodeScripts([
      { script: "scripts/reset-db.js" },
      { script: "scripts/seed.js" }
    ]);
  } else if (action === "db_seed_default") {
    label = "npm run db:seed:default";
    execution = await runNodeScripts([
      { script: "scripts/seed.js" },
      { script: "scripts/seed-profile-purchase.js" }
    ]);
  } else if (action === "admin_sessions_clear") {
    label = "npm run admin:sessions:clear";
    execution = await runNodeScripts([{ script: "scripts/clear-admin-sessions.js" }]);
  } else if (action === "db_backup") {
    label = "npm run db:backup:specflow";
    execution = await runNodeScripts([{ script: "scripts/backup-module-database.js", args: ["specflow"] }]);
    if (execution.ok) {
      const outputFileName = extractBackupFileNameFromOutput(execution.output);
      const backups = await loadBackupsForMaintenancePage();
      const matched = backups.find((item) => item.fileName === outputFileName) || backups[0];
      downloadPath = buildAdminBackupDownloadPath(matched ? matched.id : null);
    }
  } else if (action === "db_restore_selected") {
    if (!Number.isInteger(backupId) || backupId <= 0) {
      execution = { ok: false, code: -1, output: "Informe backupId valido." };
      label = "npm run db:restore-database -- <arquivo.sql>";
    } else {
      const selectedBackup = await getBackupFileById(backupId);
      if (!selectedBackup) {
        execution = { ok: false, code: -1, output: "Backup nao encontrado no catalogo." };
        label = "npm run db:restore-database -- <arquivo.sql>";
      } else if (!selectedBackup.existsOnDisk) {
        execution = { ok: false, code: -1, output: `Arquivo nao encontrado no disco: ${selectedBackup.filePath}` };
        label = `npm run db:restore-database -- "${selectedBackup.filePath}"`;
      } else {
        const restoreCommand = buildRestoreScriptArgs(selectedBackup.filePath);
        label = restoreCommand.moduleName
          ? `npm run db:restore-database -- --module=${restoreCommand.moduleName} "${selectedBackup.filePath}"`
          : `npm run db:restore-database -- "${selectedBackup.filePath}"`;
        execution = await runNodeScripts([{ script: "scripts/restore-database.js", args: restoreCommand.args }]);
      }
    }
  } else if (action === "db_delete_selected") {
    if (!Number.isInteger(backupId) || backupId <= 0) {
      execution = { ok: false, code: -1, output: "Informe backupId valido." };
      label = "Excluir backup do catalogo/disco por ID";
    } else {
      const deleted = await deleteBackupFileById(backupId, { removeFromDisk: true });
      if (!deleted) {
        execution = { ok: false, code: -1, output: "Backup nao encontrado no catalogo." };
        label = "Excluir backup do catalogo/disco por ID";
      } else {
        label = `Excluir backup ID ${backupId}`;
        const diskMessage = deleted.diskStatus === "deleted"
          ? "Arquivo removido do disco."
          : "Arquivo ja nao existia no disco.";
        execution = {
          ok: true,
          code: 0,
          output: `Backup removido do catalogo.\n${diskMessage}\nArquivo: ${deleted.backup.filePath}`
        };
      }
    }
  } else if (action === "db_restore") {
    const backups = await loadBackupsForMaintenancePage();
    const latest = backups.find((item) => item.existsOnDisk);
    if (!latest) {
      execution = { ok: false, code: -1, output: "Nenhum backup disponivel para restore." };
      label = "npm run db:restore-database -- <arquivo.sql>";
    } else {
      const restoreCommand = buildRestoreScriptArgs(latest.filePath);
      label = restoreCommand.moduleName
        ? `npm run db:restore-database -- --module=${restoreCommand.moduleName} "${latest.filePath}"`
        : `npm run db:restore-database -- "${latest.filePath}"`;
      execution = await runNodeScripts([{ script: "scripts/restore-database.js", args: restoreCommand.args }]);
    }
  } else if (action === "token_set_sent") {
    if (!token) {
      execution = { ok: false, code: -1, output: "Informe token valido." };
      label = "npm run token:set-sent -- --token=<token> (status=send)";
    } else {
      label = `npm run token:set-sent -- --token=${token} (status=send)`;
      execution = await runNodeScripts([{ script: "scripts/token-set-sent.js", args: [`--token=${token}`] }]);
    }
  } else if (action === "token_set_draft") {
    if (!token) {
      execution = { ok: false, code: -1, output: "Informe token valido." };
      label = "npm run token:set-draft -- --token=<token>";
    } else {
      label = `npm run token:set-draft -- --token=${token}`;
      execution = await runNodeScripts([{ script: "scripts/token-set-draft.js", args: [`--token=${token}`] }]);
    }
  }

  await renderAdminMaintenancePage(req, res, {
    statusCode: execution.ok ? 200 : 422,
    commandResult: {
      ...execution,
      label,
      downloadPath
    },
  });
}));

app.post(
  ["/admin/maintenance/restore-import", "/admin/maintenance/system/restore-import"],
  csrfProtection,
  requireAdminAuth,
  requireMaintenanceAdmin,
  maintenanceImportRawParser,
  asyncHandler(async (req, res) => {
    try {
      const imported = resolveImportedSqlBuffer(req);
      const outputPath = buildImportedBackupFilePath(imported.fileName);
      fs.writeFileSync(outputPath, imported.buffer);
      await syncBackupsFromDirectory(getBackupDirectoryPath());
      return res.status(200).json({
        ok: true,
        output: `Arquivo importado com sucesso: ${path.basename(outputPath)}. Use a lista de backups para executar o restore.`,
        importedFileName: path.basename(outputPath),
        importedFilePath: outputPath,
        sizeBytes: imported.buffer.length
      });
    } catch (err) {
      return res.status(422).json({
        ok: false,
        code: -1,
        label: "Importar arquivo .sql",
        output: getStandardStatusMessage(req, 422)
      });
    }
  })
);

app.get("/admin/backups/:id/download", requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const id = Number(sanitizeInput(req.params.id));
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }

  const backup = await getBackupFileById(id);
  if (!backup || !backup.filePath) {
    return sendStandardError(req, res, 404);
  }

  if (!fs.existsSync(backup.filePath)) {
    return sendStandardError(req, res, 404);
  }

  return res.download(backup.filePath, backup.fileName || path.basename(backup.filePath));
}));

app.post(["/admin/maintenance/system/admin-users/create", "/admin/maintenance/admin-users/create"], csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const username = sanitizeInput(req.body.username);
  const password = sanitizeInput(req.body.password);
  const passwordConfirm = sanitizeInput(req.body.passwordConfirm);
  const role = sanitizeInput(req.body.role).toLowerCase();
  const moduleAccess = normalizeModuleAccessInput(req.body.module_access);

  let userCreateResult = null;
  if (!username || username.length < 3) {
    userCreateResult = { ok: false, message: getStandardStatusMessage(req, 422) };
  } else if (!password || password.length < 8) {
    userCreateResult = { ok: false, message: getStandardStatusMessage(req, 422) };
  } else if (password !== passwordConfirm) {
    userCreateResult = { ok: false, message: getStandardStatusMessage(req, 422) };
  } else if (!["admin", "user"].includes(role)) {
    userCreateResult = { ok: false, message: getStandardStatusMessage(req, 422) };
  } else if (safeTimingEqual(username, String(env.admin.user || "").trim())) {
    userCreateResult = { ok: false, message: getStandardStatusMessage(req, 409) };
  } else {
    try {
      await createAdminUser({ username, password, role, moduleAccess });
      userCreateResult = { ok: true, message: `Usuario criado: ${username} (${role})` };
    } catch (err) {
      userCreateResult = { ok: false, message: getStandardStatusMessage(req, 422) };
    }
  }

  await renderSystemMaintenancePage(req, res, {
    statusCode: userCreateResult.ok ? 200 : 422,
    userCreateResult,
  });
}));

app.post(["/admin/maintenance/system/admin-users/:id/update", "/admin/maintenance/admin-users/:id/update"], csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const id = sanitizeInput(req.params.id);
  const username = sanitizeInput(req.body.username);
  const role = sanitizeInput(req.body.role).toLowerCase();
  const password = sanitizeInput(req.body.password);
  const passwordConfirm = sanitizeInput(req.body.passwordConfirm);
  const moduleAccess = normalizeModuleAccessInput(req.body.module_access);

  let userUpdateResult = null;
  if (!id) {
    userUpdateResult = { ok: false, message: getStandardStatusMessage(req, 400) };
  } else if (!username || username.length < 3) {
    userUpdateResult = { ok: false, message: getStandardStatusMessage(req, 422) };
  } else if (!["admin", "user"].includes(role)) {
    userUpdateResult = { ok: false, message: getStandardStatusMessage(req, 422) };
  } else if (password && password !== passwordConfirm) {
    userUpdateResult = { ok: false, message: getStandardStatusMessage(req, 422) };
  } else if (safeTimingEqual(username, String(env.admin.user || "").trim())) {
    userUpdateResult = { ok: false, message: getStandardStatusMessage(req, 409) };
  } else {
    try {
      await updateAdminUser({
        id,
        username,
        role,
        password: password || "",
        moduleAccess
      });
      userUpdateResult = { ok: true, message: `Usuario atualizado: ${username} (${role})` };
    } catch (err) {
      userUpdateResult = { ok: false, message: getStandardStatusMessage(req, 422) };
    }
  }

  await renderSystemMaintenancePage(req, res, {
    statusCode: userUpdateResult.ok ? 200 : 422,
    userUpdateResult,
  });
}));

app.post(["/admin/maintenance/system/admin-users/:id/delete", "/admin/maintenance/admin-users/:id/delete"], csrfProtection, requireAdminAuth, requireMaintenanceAdmin, asyncHandler(async (req, res) => {
  const id = sanitizeInput(req.params.id);
  let userDeleteResult = null;

  if (!id) {
    userDeleteResult = { ok: false, message: getStandardStatusMessage(req, 400) };
  } else {
    try {
      const deleted = await deleteAdminUser(id);
      userDeleteResult = { ok: true, message: `Usuario removido: ${deleted.username} (${deleted.role})` };
    } catch (_err) {
      userDeleteResult = { ok: false, message: getStandardStatusMessage(req, 404) };
    }
  }

  await renderSystemMaintenancePage(req, res, {
    statusCode: userDeleteResult.ok ? 200 : 404,
    userDeleteResult,
  });
}));

app.post("/admin/tokens/:id/delete", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  await deleteEquipmentById(id);
  return res.redirect("/admin/tokens?deleted=1");
}));

app.post("/admin/tokens/:id/status", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }

  const equipment = await getEquipmentById(id);
  if (!equipment) {
    return sendStandardError(req, res, 404);
  }

  const nextStatusRaw = sanitizeInput(req.body.status).toLowerCase();
  const isAllowedRaw = ["draft", "send", "closed", "sent"].includes(nextStatusRaw);
  const nextStatus = normalizeEquipmentStatus(nextStatusRaw);
  const isAllowed = isAllowedRaw && [EQUIPMENT_STATUS.DRAFT, EQUIPMENT_STATUS.SEND, EQUIPMENT_STATUS.CLOSED].includes(nextStatus);
  if (!isAllowed) {
    return sendStandardError(req, res, 422);
  }

  await updateEquipmentStatus(id, nextStatus);
  return res.redirect("/admin/tokens?token_status_saved=1");
}));

app.get("/admin/tokens/:id/config", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  const equipment = await getEquipmentById(id);
  if (!equipment) {
    return sendStandardError(req, res, 404);
  }
  await renderAdminClientConfigPage(req, res, equipment);
}));

app.post("/admin/tokens/:id/config", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  const equipment = await getEquipmentById(id);
  if (!equipment) {
    return sendStandardError(req, res, 404);
  }

  const clientData = parseClientDataFromBody(req.body);
  const profileIdRaw = sanitizeInput(req.body.profile_id);
  const selectedFieldIdsRaw = parseSelectedFieldIds(req.body.enabled_fields);
  const errors = validateClientData(clientData, req.t);

  let profileId = null;
  let selectedProfile = null;
  if (profileIdRaw) {
    const parsed = Number(profileIdRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.profile_id = req.t("admin.invalidId");
    } else {
      const profile = await getProfileById(parsed);
      if (!profile) errors.profile_id = req.t("admin.invalidId");
      else {
        profileId = profile.id;
        selectedProfile = profile;
      }
    }
  }
  const selectedFieldIds = await getAllowedSelectedFieldIds(profileId, selectedFieldIdsRaw);
  if (!selectedFieldIds.length) errors.enabled_fields = req.t("admin.newClientFieldsRequired");

  if (Object.keys(errors).length > 0) {
    return renderAdminClientConfigPage(req, res, equipment, {
      statusCode: 422,
      values: {
        purchaser: clientData.purchaser,
        purchaser_contact: clientData.purchaserContact,
        contact_email: clientData.contactEmail,
        contact_phone: clientData.contactPhone,
        project_name: clientData.projectName,
        site_name: clientData.siteName,
        address: clientData.address,
        profile_id: profileIdRaw
      },
      selectedFieldIds,
      errors
    });
  }

  await updateEquipmentConfiguration(id, {
    purchaser: clientData.purchaser,
    purchaserContact: clientData.purchaserContact,
    contactEmail: clientData.contactEmail,
    contactPhone: clientData.contactPhone,
    projectName: clientData.projectName,
    siteName: clientData.siteName,
    address: clientData.address,
    profileId,
    enabledFieldIds: selectedFieldIds
  });
  return res.redirect("/admin/tokens?saved=1");
}));

app.get("/admin/profiles", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const prefillSection = sanitizeInput(req.query.new_section);
  const editId = Number(req.query.edit);
  if (Number.isInteger(editId) && editId > 0) {
    const profile = await getProfileById(editId);
    if (profile) {
      return renderAdminProfilesPage(req, res, {
        editingProfileId: String(editId),
        formValues: { name: profile.name },
        prefillSection
      });
    }
  }
  return renderAdminProfilesPage(req, res, { prefillSection });
}));

app.get("/admin/profiles/ai", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const aiPromptTemplate = await getAiPromptTemplate();
  return renderAdminProfilesAiPage(req, res, { aiPromptTemplate });
}));

app.post("/admin/profiles/ai/generate", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const fileName = sanitizeInput(req.body.fileName || "");
  const mimeType = resolveProfileAiMimeType(req.body.mimeType || "", fileName);
  const jsonModelTemplate = String(req.body.jsonModelTemplate || "");
  const userInstructions = String(req.body.userInstructions || "");
  const promptTemplate = String(req.body.promptTemplate || "");
  const fileBase64 = String(req.body.fileBase64 || "").trim();

  if (!fileBase64) {
    return res.status(422).json({ ok: false, message: getStandardStatusMessage(req, 422) });
  }

  const allowedMimeTypes = new Set([
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel"
  ]);
  if (!allowedMimeTypes.has(mimeType)) {
    return res.status(422).json({ ok: false, message: getStandardStatusMessage(req, 422) });
  }

  let fileBuffer = Buffer.alloc(0);
  try {
    fileBuffer = Buffer.from(fileBase64, "base64");
  } catch (_err) {
    return res.status(422).json({ ok: false, message: getStandardStatusMessage(req, 422) });
  }
  if (!fileBuffer.length) {
    return res.status(422).json({ ok: false, message: getStandardStatusMessage(req, 422) });
  }
  if (fileBuffer.length > PROFILE_AI_MAX_FILE_BYTES) {
    return res.status(422).json({
      ok: false,
      message: getStandardStatusMessage(req, 422)
    });
  }

  try {
    const result = await generateProfileJsonFromDocument({
      fileBuffer,
      fileName: fileName || "documento",
      mimeType,
      jsonModelTemplate,
      userInstructions,
      promptTemplate
    });
    return res.status(200).json({
      ok: true,
      profileJson: result && result.profileJson ? result.profileJson : result,
      debug: result && result.debug ? result.debug : null
    });
  } catch (err) {
    return res.status(err.statusCode || 422).json({
      ok: false,
      message: getStandardStatusMessage(req, err.statusCode || 422),
      debug: err.debug || null
    });
  }
}));

app.post("/admin/profiles/create", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const name = sanitizeInput(req.body.name);
  const profileFields = [];
  try {
    const createdProfile = await createProfile({ name, fields: profileFields });
    await createFieldInProfile(createdProfile.id, {
      label: "Novo campo",
      section: "General",
      fieldType: "text"
    });
    return res.redirect(`/admin/profiles?edit=${createdProfile.id}&saved=1`);
  } catch (err) {
    return renderAdminProfilesPage(req, res, {
      statusCode: err.statusCode || 422,
      formValues: { name },
      fieldsForForm: profileFields,
      errors: err.details || { generic: err.message }
    });
  }
}));

app.get("/admin/profiles/:id/export", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }

  const profile = await getProfileById(id);
  if (!profile) {
    return sendStandardError(req, res, 404);
  }

  const fields = await listProfileEditableFields(id);
  const payload = buildProfileExportPayload(profile, fields);
  const safeName = String(profile.name || "profile")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "profile";
  const fileName = `${safeName}.json`;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.send(JSON.stringify(payload, null, 2));
}));

app.post("/admin/profiles/import", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  try {
    const imported = parseImportedProfilePayload(req.body.profile_json);
    const createdProfile = await createProfile({ name: imported.name, fields: [] });
    const importedFields = [];

    for (const field of imported.fields) {
      // eslint-disable-next-line no-await-in-loop
      const createdField = await createFieldInProfile(createdProfile.id, {
        key: field.key,
        label: field.label,
        section: field.section,
        fieldType: field.fieldType,
        unit: field.unit,
        enumOptions: field.enumOptions,
        isRequired: field.isRequired,
        hasDefault: field.hasDefault,
        defaultValue: field.defaultValue
      });
      importedFields.push({
        fieldId: createdField.id,
        isEnabled: field.isEnabled,
        isRequired: field.isRequired,
        label: field.label,
        section: field.section,
        fieldType: field.fieldType,
        unit: field.unit,
        enumOptions: field.enumOptions,
        hasDefault: field.hasDefault,
        defaultValue: field.defaultValue,
        displayOrder: Number(field.displayOrder || 0)
      });
    }

    await updateProfile(createdProfile.id, {
      name: imported.name,
      fields: importedFields
    });
    return res.redirect(`/admin/profiles?edit=${createdProfile.id}&saved=1`);
  } catch (err) {
    return renderAdminProfilesPage(req, res, {
      statusCode: err.statusCode || 422,
      errors: {
        import: err.message || req.t("admin.profileImportInvalid")
      }
    });
  }
}));

app.post("/admin/profiles/:id/update", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  const name = sanitizeInput(req.body.name);
  const baseFields = await listProfileEditableFields(id);
  const profileFields = parseProfileFieldsFromBody(baseFields, req.body);
  try {
    await updateProfile(id, { name, fields: profileFields });
    return res.redirect("/admin/profiles?saved=1");
  } catch (err) {
    return renderAdminProfilesPage(req, res, {
      statusCode: err.statusCode || 422,
      editingProfileId: String(id),
      formValues: { name },
      fieldsForForm: profileFields,
      errors: err.details || { generic: err.message }
    });
  }
}));

app.post("/admin/profiles/ai/prompt-template", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const promptTemplate = String(req.body.promptTemplate || "");
  const saved = await setAiPromptTemplate(promptTemplate);
  return res.status(200).json({
    ok: true,
    promptTemplate: saved
  });
}));

app.post("/admin/profiles/:id/clone", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }

  const profile = await getProfileById(id);
  if (!profile) {
    return sendStandardError(req, res, 404);
  }

  const sourceFields = await listProfileEditableFields(id);
  const cloneFields = sourceFields.map((field) => ({
    fieldId: field.fieldId,
    isEnabled: field.isEnabled,
    isRequired: field.isRequired,
    label: field.label,
    section: field.section,
    fieldType: field.fieldType,
    unit: field.unit,
    enumOptions: Array.isArray(field.enumOptions) ? [...field.enumOptions] : null,
    hasDefault: field.hasDefault,
    defaultValue: field.defaultValue,
    displayOrder: Number(field.displayOrder || 0)
  }));

  const copyLabel = req.lang === "en" ? "Copy" : "Copia";
  let attempt = 0;
  let clonedProfile = null;
  while (attempt < 50 && !clonedProfile) {
    const suffix = attempt === 0 ? `${copyLabel}` : `${copyLabel} ${attempt + 1}`;
    const clonedName = `${profile.name} (${suffix})`;
    try {
      // eslint-disable-next-line no-await-in-loop
      clonedProfile = await createProfile({ name: clonedName, fields: cloneFields });
    } catch (err) {
      if (err && err.statusCode === 409) {
        attempt += 1;
        continue;
      }
      throw err;
    }
  }

  if (!clonedProfile) {
    return renderAdminProfilesPage(req, res, {
      statusCode: 422,
      errors: { generic: req.t("admin.profileCloneFailed") }
    });
  }

  return res.redirect(`/admin/profiles?edit=${clonedProfile.id}&saved=1`);
}));

app.post("/admin/profiles/:id/delete", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  await deleteProfile(id);
  return res.redirect("/admin/profiles?deleted=1");
}));

app.post("/admin/profiles/:id/fields/create", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  const payload = parseProfileNewFieldFromBody(req.body, sanitizeInput(req.body.new_field_section) || "General");
  const newFieldValues = {
    key: payload.key,
    label: payload.label,
    section: payload.section,
    field_type: payload.fieldType,
    unit: payload.unit || "",
    enum_options: (payload.enumOptions || []).join("\n"),
    is_required: payload.isRequired,
    has_default: payload.hasDefault,
    default_value: payload.defaultValue || ""
  };
  try {
    await createFieldInProfile(id, payload);
    return res.redirect(`/admin/profiles?edit=${id}&saved=1`);
  } catch (err) {
    const profile = await getProfileById(id);
    return renderAdminProfilesPage(req, res, {
      statusCode: err.statusCode || 422,
      editingProfileId: String(id),
      formValues: { name: profile ? profile.name : "" },
      newFieldValues,
      errors: err.details || { generic: err.message }
    });
  }
}));

app.post("/admin/profiles/:id/fields/:fieldId/delete", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const fieldId = Number(req.params.fieldId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(fieldId) || fieldId <= 0) {
    return sendStandardError(req, res, 400);
  }
  await deleteFieldFromProfile(id, fieldId);
  return res.redirect(`/admin/profiles?edit=${id}&saved=1`);
}));

app.post("/admin/profiles/:id/sections/clear", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  const sectionName = sanitizeInput(req.body.section_name || req.body.clear_section);
  await clearSectionFromProfile(id, sectionName);
  return res.redirect(`/admin/profiles?edit=${id}&saved=1`);
}));

app.post("/admin/profiles/:id/clear", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  await clearAllFieldsFromProfile(id);
  return res.redirect(`/admin/profiles?edit=${id}&saved=1`);
}));

app.get("/admin/clients/new", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  await renderAdminNewClientPage(req, res);
}));

app.post("/admin/clients/new", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const clientData = parseClientDataFromBody(req.body);
  const profileIdRaw = sanitizeInput(req.body.profile_id);
  const selectedFieldIdsRaw = parseSelectedFieldIds(req.body.enabled_fields);
  const errors = validateClientData(clientData, req.t);

  let selectedProfile = null;
  if (profileIdRaw) {
    const profileId = Number(profileIdRaw);
    if (!Number.isInteger(profileId) || profileId <= 0) {
      errors.profile_id = req.t("admin.invalidId");
    } else {
      selectedProfile = await getProfileById(profileId);
      if (!selectedProfile) {
        errors.profile_id = req.t("admin.invalidId");
      }
    }
  }
  const selectedFieldIds = await getAllowedSelectedFieldIds(selectedProfile ? selectedProfile.id : null, selectedFieldIdsRaw);
  if (!selectedFieldIds.length) errors.enabled_fields = req.t("admin.newClientFieldsRequired");

  if (Object.keys(errors).length > 0) {
    return renderAdminNewClientPage(req, res, {
      statusCode: 422,
      values: {
        purchaser: clientData.purchaser,
        purchaser_contact: clientData.purchaserContact,
        contact_email: clientData.contactEmail,
        contact_phone: clientData.contactPhone,
        project_name: clientData.projectName,
        site_name: clientData.siteName,
        address: clientData.address,
        profile_id: profileIdRaw
      },
      errors,
      selectedFieldIds
    });
  }

  const profileId = selectedProfile ? selectedProfile.id : null;
  const dedupeKey = buildClientCreateDedupeKey(req, clientData, profileId, selectedFieldIds);
  const now = Date.now();
  cleanupExpiredClientCreates(now);

  const recent = recentClientCreateByKey.get(dedupeKey);
  if (recent && recent.token && recent.expiresAt > now) {
    return res.redirect(`/form/${recent.token}/specification`);
  }

  let pending = pendingClientCreateByKey.get(dedupeKey);
  if (!pending) {
    pending = createEquipment({
      purchaser: clientData.purchaser,
      purchaserContact: clientData.purchaserContact,
      contactEmail: clientData.contactEmail,
      contactPhone: clientData.contactPhone,
      projectName: clientData.projectName,
      siteName: clientData.siteName,
      address: clientData.address,
      profileId,
      enabledFieldIds: selectedFieldIds
    });
    pendingClientCreateByKey.set(dedupeKey, pending);
  }

  const equipment = await pending.finally(() => {
    pendingClientCreateByKey.delete(dedupeKey);
  });
  recentClientCreateByKey.set(dedupeKey, {
    token: equipment.token,
    expiresAt: now + CLIENT_CREATE_DEDUPE_TTL_MS
  });
  return res.redirect(`/form/${equipment.token}/specification`);
}));

app.get("/admin/fields", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const prefillSection = sanitizeInput(req.query.new_section);
  const editId = Number(req.query.edit);
  if (Number.isInteger(editId) && editId > 0) {
    const field = await getFieldById(editId);
    if (field) {
      await renderAdminFieldsPage(req, res, {
        editingFieldId: String(editId),
        formValues: {
          key: field.key,
          label: field.label,
          section: field.section,
          field_type: field.fieldType,
          unit: field.unit || "",
          enum_options: Array.isArray(field.enumOptions) ? field.enumOptions.join("\n") : "",
          has_default: field.hasDefault,
          default_value: field.hasDefault ? JSON.stringify(field.defaultValue) : ""
        }
      });
      return;
    }
  }
  await renderAdminFieldsPage(req, res, { prefillSection });
}));

app.post("/admin/fields/create", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const payload = parseFieldPayloadFromBody(req.body);
  const formValues = {
    key: payload.key,
    label: payload.label,
    section: payload.section,
    field_type: payload.fieldType,
    unit: payload.unit || "",
    enum_options: (payload.enumOptions || []).join("\n"),
    has_default: payload.hasDefault,
    default_value: payload.defaultValue || ""
  };
  try {
    await createField(payload);
    return res.redirect("/admin/fields?saved=1");
  } catch (err) {
    return renderAdminFieldsPage(req, res, {
      statusCode: err.statusCode || 422,
      errors: err.details || { generic: err.message },
      formValues
    });
  }
}));

app.post("/admin/fields/:id/update", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  const payload = parseFieldPayloadFromBody(req.body);
  const formValues = {
    key: payload.key,
    label: payload.label,
    section: payload.section,
    field_type: payload.fieldType,
    unit: payload.unit || "",
    enum_options: (payload.enumOptions || []).join("\n"),
    has_default: payload.hasDefault,
    default_value: payload.defaultValue || ""
  };
  try {
    await updateField(id, payload);
    return res.redirect("/admin/fields?saved=1");
  } catch (err) {
    return renderAdminFieldsPage(req, res, {
      statusCode: err.statusCode || 422,
      errors: err.details || { generic: err.message },
      formValues,
      editingFieldId: String(id)
    });
  }
}));

app.post("/admin/fields/:id/delete", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }
  await deleteField(id);
  return res.redirect("/admin/fields?deleted=1");
}));

if (env.moduleSpecEnabled) {
  app.get("/admin/module-spec", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
    await renderAdminModuleSpecPage(req, res);
  }));

app.post("/admin/module-spec/families/create", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  try {
    await moduleSpecRepo.createFamily({
      key: sanitizeInput(req.body.key).toLowerCase(),
      name: sanitizeInput(req.body.name),
      description: sanitizeInput(req.body.description || ""),
      status: sanitizeInput(req.body.status || "active")
    });
    return res.redirect("/admin/module-spec?saved=1");
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      flashError: err.message,
      formValues: { category: req.body }
    });
  }
}));

app.post("/admin/module-spec/families/:id/update", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  try {
    await moduleSpecRepo.updateFamily(id, {
      key: sanitizeInput(req.body.key).toLowerCase(),
      name: sanitizeInput(req.body.name),
      description: sanitizeInput(req.body.description || ""),
      status: sanitizeInput(req.body.status || "active")
    });
    return res.redirect(`/admin/module-spec?edit_family=${id}&saved=1`);
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      editFamilyId: id,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/families/:id/delete", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  try {
    await moduleSpecRepo.deleteFamily(id);
    return res.redirect("/admin/module-spec?deleted=1");
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/attributes/create", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  try {
    await moduleSpecRepo.createAttributeDefinition({
      key: sanitizeInput(req.body.key).toLowerCase(),
      label: sanitizeInput(req.body.label),
      dataType: sanitizeInput(req.body.data_type).toLowerCase(),
      unit: sanitizeInput(req.body.unit),
      allowedValuesJson: parseModuleSpecJsonInput(req.body.allowed_values_json, []),
      description: sanitizeInput(req.body.description || ""),
      status: sanitizeInput(req.body.status || "active")
    });
    return res.redirect("/admin/module-spec?saved=1");
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      flashError: err.message,
      formValues: { attribute: req.body }
    });
  }
}));

app.post("/admin/module-spec/attributes/:id/update", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  try {
    await moduleSpecRepo.updateAttributeDefinition(id, {
      key: sanitizeInput(req.body.key).toLowerCase(),
      label: sanitizeInput(req.body.label),
      dataType: sanitizeInput(req.body.data_type).toLowerCase(),
      unit: sanitizeInput(req.body.unit),
      allowedValuesJson: parseModuleSpecJsonInput(req.body.allowed_values_json, []),
      description: sanitizeInput(req.body.description || ""),
      status: sanitizeInput(req.body.status || "active")
    });
    return res.redirect(`/admin/module-spec?edit_attribute=${id}&saved=1`);
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      editAttributeId: id,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/attributes/:id/delete", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  try {
    await moduleSpecRepo.deleteAttributeDefinition(id);
    return res.redirect("/admin/module-spec?deleted=1");
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/models/create", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  try {
    await moduleSpecRepo.createModel({
      familyId: Number(req.body.family_id),
      manufacturer: sanitizeInput(req.body.manufacturer),
      brand: sanitizeInput(req.body.brand),
      model: sanitizeInput(req.body.model),
      sku: sanitizeInput(req.body.sku),
      description: sanitizeInput(req.body.description),
      status: sanitizeInput(req.body.status) || "active"
    });
    return res.redirect("/admin/module-spec?saved=1");
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      flashError: err.message,
      formValues: { model: req.body }
    });
  }
}));

app.post("/admin/module-spec/models/:id/update", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  try {
    await moduleSpecRepo.updateModel(id, {
      familyId: Number(req.body.family_id),
      manufacturer: sanitizeInput(req.body.manufacturer),
      brand: sanitizeInput(req.body.brand),
      model: sanitizeInput(req.body.model),
      sku: sanitizeInput(req.body.sku),
      description: sanitizeInput(req.body.description),
      status: sanitizeInput(req.body.status) || "active"
    });
    return res.redirect(`/admin/module-spec?edit_model=${id}&saved=1`);
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      editModelId: id,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/models/:id/delete", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  try {
    await moduleSpecRepo.deleteModel(id);
    return res.redirect("/admin/module-spec?deleted=1");
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/models/:id/variants/create", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const modelId = Number(req.params.id);
  try {
    await moduleSpecRepo.createVariant(modelId, {
      variantName: sanitizeInput(req.body.variant_name),
      variantCode: sanitizeInput(req.body.variant_code),
      status: sanitizeInput(req.body.status || "active")
    });
    return res.redirect(`/admin/module-spec?edit_model=${modelId}&saved=1`);
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      editModelId: modelId,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/variants/:id/update", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  try {
    const updated = await moduleSpecRepo.updateVariant(id, {
      variantName: sanitizeInput(req.body.variant_name),
      variantCode: sanitizeInput(req.body.variant_code),
      status: sanitizeInput(req.body.status) || "active"
    });
    return res.redirect(`/admin/module-spec?edit_model=${updated.equipmentModelId}&edit_variant=${id}&saved=1`);
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      flashError: err.message,
      editVariantId: id
    });
  }
}));

app.post("/admin/module-spec/variants/:id/delete", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  try {
    const variant = await moduleSpecRepo.getVariantById(id);
    await moduleSpecRepo.deleteVariant(id);
    return res.redirect(`/admin/module-spec?edit_model=${variant ? variant.equipmentModelId : ""}&deleted=1`);
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/variants/:id/attributes", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  try {
    const attributes = parseModuleSpecJsonInput(req.body.attributes_json, []);
    await moduleSpecRepo.replaceVariantAttributes(id, attributes);
    const variant = await moduleSpecRepo.getVariantById(id);
    return res.redirect(`/admin/module-spec?edit_model=${variant ? variant.equipmentModelId : ""}&edit_variant=${id}&saved=1`);
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      editVariantId: id,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/profiles/:profileId/mappings", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const profileId = Number(req.params.profileId);
  try {
    const mappings = await moduleSpecValidateMappingsPayload(profileId, parseModuleSpecJsonInput(req.body.mappings_json, []));
    await moduleSpecRepo.replaceProfileFilterMappings(profileId, mappings);
    return res.redirect(`/admin/module-spec?profile_id=${profileId}&saved=1`);
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      profileId,
      flashError: err.message
    });
  }
}));

app.post("/admin/module-spec/profiles/:profileId/filter-test", csrfProtection, requireAdminAuth, asyncHandler(async (req, res) => {
  const profileId = Number(req.params.profileId);
  try {
    const filterResult = await moduleSpecExecuteSimpleFilter({
      profileId,
      required: parseModuleSpecJsonInput(req.body.required_json, {})
    });
    return renderAdminModuleSpecPage(req, res, { profileId, filterResult });
  } catch (err) {
    return renderAdminModuleSpecPage(req, res, {
      statusCode: err.statusCode || 422,
      profileId,
      flashError: err.message
    });
  }
}));

  app.get("/admin/module-spec/profiles/:id/fields", requireAdminAuth, asyncHandler(async (req, res) => {
    const profileId = Number(req.params.id);
    if (!Number.isInteger(profileId) || profileId <= 0) return sendStandardError(req, res, 400, { json: true });
    const profile = await getProfileById(profileId);
    if (!profile) return sendStandardError(req, res, 404, { json: true });
    const fields = await listProfileFieldsForSpecification(profileId);
    return res.json({
      data: {
        profileId: profile.id,
        profileName: profile.name,
        fields: fields.map((field) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          fieldType: field.fieldType
        }))
      }
    });
  }));
}

app.get("/fields", requireApiScope("fields:read"), asyncHandler(async (req, res) => {
  const section = sanitizeInput(req.query.section);
  const data = await listFields(section ? { section } : {});
  res.json({ data });
}));

app.post("/fields", requireApiScope("fields:write"), asyncHandler(async (req, res) => {
  const created = await createField(req.body || {});
  res.status(201).json({ data: created });
}));

app.put("/fields/:id", requireApiScope("fields:write"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400, { json: true });
  }
  const updated = await updateField(id, req.body || {});
  res.json({ data: updated });
}));

app.delete("/fields/:id", requireApiScope("fields:write"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400, { json: true });
  }
  const deleted = await deleteField(id);
  if (!deleted) return sendStandardError(req, res, 404, { json: true });
  return res.status(204).send();
}));

app.get("/equipment/:id/specification", requireApiScope("spec:read"), requireAdminApiAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400, { json: true });
  }
  const equipment = await getEquipmentById(id);
  if (!equipment) return sendStandardError(req, res, 404, { json: true });
  const section = sanitizeInput(req.query.section);
  const data = await getEquipmentSpecification(id, section || null, req.lang);
  res.json({ data });
}));

app.put("/equipment/:id/specification", requireApiScope("spec:write"), requireAdminApiAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400, { json: true });
  }
  const equipment = await getEquipmentById(id);
  if (!equipment) return sendStandardError(req, res, 404, { json: true });
  const values = req.body && req.body.values ? req.body.values : {};
  const result = await saveEquipmentSpecification(id, values);
  res.json({ data: result });
}));

app.get("/form/:token/specification", csrfProtection, asyncHandler(async (req, res) => {
  const equipment = await resolveEquipmentByTokenOr404(req, res);
  if (!equipment) return;
  if (!canEditEquipmentSpecification(req, equipment)) {
    return res.redirect(`/form/${equipment.token}/review?locked=1`);
  }
  const specification = await getEquipmentSpecification(equipment.id, null, req.lang);
  const documents = withTokenDocumentLinks(await listEquipmentDocuments(equipment.id), equipment.token);
  const qrByTheme = await buildThemeAwareQrData(equipment.token);
  const initialTheme = resolveUiTheme(req);
  res.render("section", {
    pageTitle: req.t("section.headerTitle"),
    openGraph: buildTokenOpenGraph(equipment, "specification"),
    equipment,
    publicDraftMode: false,
    displayToken: equipment.token,
    clientValues: {
      purchaser: equipment.purchaser || "",
      purchaser_contact: equipment.purchaserContact || "",
      contact_email: equipment.contactEmail || "",
      contact_phone: equipment.contactPhone || "",
      project_name: equipment.projectName || "",
      site_name: equipment.siteName || "",
      address: equipment.address || ""
    },
    sections: buildSpecificationRenderModel(specification),
    documents,
    reviewUrl: `/form/${equipment.token}/review`,
    uploadUrl: `/form/${equipment.token}/docs/upload`,
    documentsEnabled: true,
    docsMaxCount: MAX_DOCS_PER_EQUIPMENT,
    docsMaxSizeBytes: MAX_DOC_SIZE_BYTES,
    errors: {},
    clientErrors: {},
    saved: req.query.saved === "1",
    qrDataUrl: qrByTheme[initialTheme],
    qrDataUrlSoft: qrByTheme.soft,
    qrDataUrlVextrom: qrByTheme.vextrom,
    csrfToken: req.csrfToken()
  });
}));

app.get("/og/token/:token.svg", asyncHandler(async (req, res) => {
  const token = sanitizeInput(req.params.token).slice(0, 120);
  if (!token) {
    return sendStandardError(req, res, 404);
  }
  const equipment = await getEquipmentByToken(token);
  if (!equipment) {
    return sendStandardError(req, res, 404);
  }

  const profileName = sanitizeInput(equipment.profileName || "SpecFlow").slice(0, 80) || "SpecFlow";
  const purchaser = sanitizeInput(equipment.purchaser || "Cliente").slice(0, 90) || "Cliente";
  const safeToken = sanitizeInput(equipment.token || token).slice(0, 120);
  const titleText = escapeXml(profileName);
  const subtitleText = escapeXml(purchaser);
  const tokenText = escapeXml(safeToken);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Token ${tokenText}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eef5ef"/>
      <stop offset="100%" stop-color="#d9ecd9"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1200" height="630" fill="url(#bg)"/>
  <rect x="56" y="52" width="1088" height="526" rx="24" ry="24" fill="#f8fcf8" stroke="#b9d1b9" stroke-width="3"/>
  <text x="92" y="150" fill="#2d7b3b" font-size="30" font-family="Inter, Segoe UI, Arial, sans-serif" font-weight="700">VEXTROM SPECFLOW</text>
  <text x="92" y="208" fill="#1d4b2c" font-size="46" font-family="Inter, Segoe UI, Arial, sans-serif" font-weight="700">${titleText}</text>
  <text x="92" y="258" fill="#31563c" font-size="30" font-family="Inter, Segoe UI, Arial, sans-serif">${subtitleText}</text>
  <text x="92" y="340" fill="#1e6738" font-size="24" font-family="Inter, Segoe UI, Arial, sans-serif" font-weight="700">TOKEN GERADO</text>
  <rect x="92" y="366" width="1016" height="138" rx="16" ry="16" fill="#e7f2e7" stroke="#95bc9b" stroke-width="2"/>
  <text x="120" y="448" fill="#10321a" font-size="52" font-family="Consolas, Menlo, monospace" font-weight="700">${tokenText}</text>
</svg>`;

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.send(svg);
}));

app.post("/form/:token/specification", csrfProtection, asyncHandler(async (req, res) => {
  const equipment = await resolveEquipmentByTokenOr404(req, res);
  if (!equipment) return;
  if (!canEditEquipmentSpecification(req, equipment)) {
    return res.redirect(`/form/${equipment.token}/review?locked=1`);
  }

  const clientData = parseClientDataFromBody(req.body);
  const clientErrors = validateClientData(clientData, req.t);

  const specification = await getEquipmentSpecification(equipment.id, null, req.lang);
  const allFields = specification.sections.flatMap((section) => section.fields);
  const parsed = parseSpecificationFormBody(allFields, req.body);
  if (Object.keys(parsed.errors).length > 0 || Object.keys(clientErrors).length > 0) {
    const documents = withTokenDocumentLinks(await listEquipmentDocuments(equipment.id), equipment.token);
    const qrByTheme = await buildThemeAwareQrData(equipment.token);
    const initialTheme = resolveUiTheme(req);
    return res.status(422).render("section", {
      pageTitle: req.t("section.headerTitle"),
      openGraph: buildTokenOpenGraph(equipment, "specification"),
      equipment,
      publicDraftMode: false,
      displayToken: equipment.token,
      clientValues: {
        purchaser: clientData.purchaser,
        purchaser_contact: clientData.purchaserContact,
        contact_email: clientData.contactEmail,
        contact_phone: clientData.contactPhone,
        project_name: clientData.projectName,
        site_name: clientData.siteName,
        address: clientData.address
      },
      sections: buildSpecificationRenderModel(specification, parsed.submittedValues),
      documents,
      reviewUrl: `/form/${equipment.token}/review`,
      uploadUrl: `/form/${equipment.token}/docs/upload`,
      documentsEnabled: true,
      docsMaxCount: MAX_DOCS_PER_EQUIPMENT,
      docsMaxSizeBytes: MAX_DOC_SIZE_BYTES,
      errors: parsed.errors,
      clientErrors,
      saved: false,
      qrDataUrl: qrByTheme[initialTheme],
      qrDataUrlSoft: qrByTheme.soft,
      qrDataUrlVextrom: qrByTheme.vextrom,
      csrfToken: req.csrfToken()
    });
  }

  await updateEquipmentClientData(equipment.id, {
    purchaser: clientData.purchaser,
    purchaserContact: clientData.purchaserContact,
    contactEmail: clientData.contactEmail,
    contactPhone: clientData.contactPhone,
    projectName: clientData.projectName,
    siteName: clientData.siteName,
    address: clientData.address
  });
  await saveEquipmentSpecification(equipment.id, parsed.values);
  if (sanitizeInput(req.body.action) === "review") {
    return res.redirect(`/form/${equipment.token}/review`);
  }
  return res.redirect(`/form/${equipment.token}/specification?saved=1`);
}));

app.post(
  "/form/:token/docs/upload",
  express.raw({ type: "application/pdf", limit: `${Math.ceil(MAX_DOC_SIZE_BYTES / (1024 * 1024))}mb` }),
  csrfProtection,
  asyncHandler(async (req, res) => {
    const equipment = await resolveEquipmentByTokenOr404(req, res);
    if (!equipment) return;
    if (!canEditEquipmentSpecification(req, equipment)) {
      return sendStandardError(req, res, 403, { json: true, errorCode: "SPECIFICATION_LOCKED" });
    }

    let decodedFileName = "documento.pdf";
    try {
      decodedFileName = decodeURIComponent(req.headers["x-file-name"] || "documento.pdf");
    } catch (_err) {
      decodedFileName = "documento.pdf";
    }
    const fileName = sanitizeInput(decodedFileName);
    const mimeType = sanitizeInput(req.headers["content-type"] || "application/pdf");
    const sizeBytes = Number(req.headers["content-length"] || (Buffer.isBuffer(req.body) ? req.body.length : 0));

    const created = await saveEquipmentDocument({
      equipmentId: equipment.id,
      token: equipment.token,
      originalName: fileName || "documento.pdf",
      mimeType,
      sizeBytes,
      buffer: req.body
    });

    res.status(201).json({
      data: {
        id: created.id,
        originalName: created.originalName,
        downloadPath: buildTokenDocumentDownloadPath(equipment.token, created.id),
        downloadUrl: withTokenDocumentLinks([created], equipment.token)[0]?.downloadUrl || created.downloadUrl,
        sizeBytes: created.sizeBytes
      }
    });
  })
);

app.get("/form/:token/documents/:id/download", asyncHandler(async (req, res) => {
  const equipment = await resolveEquipmentByTokenOr404(req, res);
  if (!equipment) return;
  const isAdminAuthenticated = isValidAdminSessionToken(req.cookies[ADMIN_SESSION_COOKIE_NAME]);
  if (normalizeEquipmentStatus(equipment.status) !== EQUIPMENT_STATUS.DRAFT && !isAdminAuthenticated) {
    return sendStandardError(req, res, 403);
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }

  const document = await getEquipmentDocumentById(id);
  if (!document || Number(document.equipmentId) !== Number(equipment.id)) {
    return sendStandardError(req, res, 404);
  }

  const safeStoredName = path.basename(String(document.storedName || ""));
  const absolutePath = path.join(path.resolve(env.storage.docsDir), safeStoredName);
  if (!fs.existsSync(absolutePath)) {
    return sendStandardError(req, res, 404);
  }

  return res.download(absolutePath, document.originalName || safeStoredName);
}));

app.post("/form/:token/documents/:id/delete", csrfProtection, asyncHandler(async (req, res) => {
  const equipment = await resolveEquipmentByTokenOr404(req, res);
  if (!equipment) return;
  if (!canEditEquipmentSpecification(req, equipment)) {
    return sendStandardError(req, res, 403, { json: true, errorCode: "SPECIFICATION_LOCKED" });
  }

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400, { json: true });
  }

  const document = await getEquipmentDocumentById(id);
  if (!document || Number(document.equipmentId) !== Number(equipment.id)) {
    return sendStandardError(req, res, 404, { json: true });
  }

  const deleted = await deleteEquipmentDocumentById(id);
  if (!deleted) {
    return sendStandardError(req, res, 404, { json: true });
  }

  const safeStoredName = path.basename(String(document.storedName || ""));
  const absolutePath = path.join(path.resolve(env.storage.docsDir), safeStoredName);
  if (fs.existsSync(absolutePath)) {
    try {
      fs.unlinkSync(absolutePath);
    } catch (_err) {
      // Keep DB deletion as source of truth; file cleanup is best-effort.
    }
  }

  return res.status(200).json({ ok: true, id });
}));

app.get("/admin/documents/:id/download", requireAdminAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendStandardError(req, res, 400);
  }

  const document = await getEquipmentDocumentById(id);
  if (!document) {
    return sendStandardError(req, res, 404);
  }

  const safeStoredName = path.basename(String(document.storedName || ""));
  const absolutePath = path.join(path.resolve(env.storage.docsDir), safeStoredName);
  if (!fs.existsSync(absolutePath)) {
    return sendStandardError(req, res, 404);
  }

  return res.download(absolutePath, document.originalName || safeStoredName);
}));

app.get("/form/:token/review", csrfProtection, asyncHandler(async (req, res) => {
  const equipment = await resolveEquipmentByTokenOr404(req, res);
  if (!equipment) return;
  const specification = await getEquipmentSpecification(equipment.id, null, req.lang);
  const documents = withTokenDocumentLinks(await listEquipmentDocuments(equipment.id), equipment.token);
  const qrByTheme = await buildThemeAwareQrData(equipment.token);
  const initialTheme = resolveUiTheme(req);
  const emailErrorMap = {
    invalid_to: req.t("app.invalidRecipientEmail"),
    invalid_cc: req.t("app.invalidCcEmail")
  };
  const emailErrorKey = sanitizeInput(req.query.email_error).toLowerCase();
  const emailError = emailErrorMap[emailErrorKey] || "";
  res.render("review", {
    pageTitle: req.t("app.reviewTitle"),
    openGraph: buildTokenOpenGraph(equipment, "review"),
    equipment,
    sections: buildSpecificationRenderModel(specification),
    documents,
    emailSent: req.query.email === "1",
    lockedNotice: req.query.locked === "1",
    emailError,
    formEmailTo: sanitizeInput(req.query.to),
    formEmailCc: sanitizeInput(req.query.cc),
    qrDataUrl: qrByTheme[initialTheme],
    qrDataUrlSoft: qrByTheme.soft,
    qrDataUrlVextrom: qrByTheme.vextrom,
    csrfToken: req.csrfToken()
  });
}));

const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false
});

app.post("/form/:token/send-email", csrfProtection, emailLimiter, asyncHandler(async (req, res) => {
  const equipment = await resolveEquipmentByTokenOr404(req, res);
  if (!equipment) return;
  const toRaw = sanitizeInput(req.body.to);
  const ccRaw = sanitizeInput(req.body.cc);
  const emailSettings = await getEmailSettings();
  const userTo = parseEmailListInput(toRaw);
  const systemDefaultRecipients = Array.isArray(emailSettings.defaultRecipients) ? emailSettings.defaultRecipients : [];
  const to = mergeEmailLists(userTo, systemDefaultRecipients);
  const cc = parseEmailListInput(ccRaw);

  if (!userTo.length || userTo.some((email) => !isValidEmailAddress(email))) {
    return res.redirect(`/form/${equipment.token}/review?email_error=invalid_to&to=${encodeURIComponent(toRaw)}&cc=${encodeURIComponent(ccRaw)}`);
  }
  if (systemDefaultRecipients.some((email) => !isValidEmailAddress(email))) {
    return sendStandardError(req, res, 500);
  }
  if (to.some((email) => !isValidEmailAddress(email))) {
    return sendStandardError(req, res, 500);
  }
  if (cc.some((email) => !isValidEmailAddress(email))) {
    return res.redirect(`/form/${equipment.token}/review?email_error=invalid_cc&to=${encodeURIComponent(toRaw)}&cc=${encodeURIComponent(ccRaw)}`);
  }

  const specification = await getEquipmentSpecification(equipment.id, null, req.lang);
  const sections = buildSpecificationRenderModel(specification);
  try {
    const documents = await listEquipmentDocuments(equipment.id);
    const pdfTheme = resolvePdfUiTheme(req);
    const pdfTemplate = await resolvePdfTemplateForTheme(pdfTheme);
    const pdfBuffer = await generatePdfBuffer({
      submission: equipment,
      sections,
      documents,
      lang: req.lang,
      theme: pdfTheme,
      pdfTemplate
    });
    await sendSubmissionEmail({ to, cc, submission: equipment, sections, pdfBuffer, lang: req.lang });
    await updateEquipmentStatus(equipment.id, EQUIPMENT_STATUS.SEND);
    return res.redirect(`/form/${equipment.token}/review?email=1`);
  } catch (err) {
    return sendStandardError(req, res, 500);
  }
}));

app.get("/form/:token/pdf", asyncHandler(async (req, res) => {
  const equipment = await resolveEquipmentByTokenOr404(req, res);
  if (!equipment) return;
  const specification = await getEquipmentSpecification(equipment.id, null, req.lang);
  const sections = buildSpecificationRenderModel(specification);
  const documents = await listEquipmentDocuments(equipment.id);
  const pdfTheme = resolvePdfUiTheme(req);
  const pdfTemplate = await resolvePdfTemplateForTheme(pdfTheme);
  const pdfBuffer = await generatePdfBuffer({
    submission: equipment,
    sections,
    documents,
    lang: req.lang,
    theme: pdfTheme,
    pdfTemplate
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=annexD-${equipment.token}.pdf`);
  res.send(pdfBuffer);
}));

app.get("/form/:token/export.json", requireAdminAuth, asyncHandler(async (req, res) => {
  const equipment = await resolveEquipmentByTokenOr404(req, res);
  if (!equipment) return;
  const specification = await getEquipmentSpecification(equipment.id, null, req.lang);
  const enabledFieldIds = await getEnabledFieldIdsForEquipment(equipment.id);
  const payload = buildSubmissionExportPayload(equipment, specification, enabledFieldIds);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=submission-${equipment.token}.json`);
  res.send(JSON.stringify(payload, null, 2));
}));

app.get("/form/start", (req, res) => {
  res.redirect("/admin/clients/new");
});

app.get("/form/public-start", asyncHandler(async (req, res) => {
  return sendStandardError(req, res, 404);
}));

app.get("/form/public/:linkSlug/start", asyncHandler(async (req, res) => {
  const linkSlug = sanitizeInput(req.params.linkSlug);
  const link = await getPublicTokenLinkBySlug(linkSlug);
  if (!link || !link.isActive) {
    return sendStandardError(req, res, 404);
  }

  const ipHash = hashIdentifier(getClientIp(req));
  const browserSessionId = getOrCreatePublicBrowserSessionId(req, res);
  const browserSessionHash = hashIdentifier(browserSessionId);
  const userAgentHash = hashIdentifier(req.headers["user-agent"] || "");
  const limitState = await checkPublicTokenCreationLimit({
    ipHash,
    browserSessionHash
  });

  if (limitState.blocked) {
    return sendStandardError(req, res, 429);
  }
  await registerTokenCreationAudit({
    equipmentId: null,
    channel: "public-link",
    ipHash,
    browserSessionHash,
    userAgentHash
  });
  const draftToken = createPublicDraftToken();
  return res.redirect(`/form/public/${link.slug}/${draftToken}/specification`);
}));

app.get("/form/public/:linkSlug/:draftToken/specification", csrfProtection, asyncHandler(async (req, res) => {
  const linkSlug = sanitizeInput(req.params.linkSlug);
  const draftToken = sanitizeInput(req.params.draftToken);
  if (!isValidPublicDraftToken(draftToken)) {
    return sendStandardError(req, res, 404);
  }

  const link = await getPublicTokenLinkBySlug(linkSlug);
  if (!link || !link.isActive) {
    return sendStandardError(req, res, 404);
  }

  const specification = await getSpecificationTemplateForProfile(link.profileId);
  res.render("section", {
    pageTitle: req.t("section.headerTitle"),
    equipment: {
      id: null,
      token: draftToken,
      purchaser: "",
      purchaserContact: "",
      contactEmail: "",
      contactPhone: "",
      projectName: "",
      siteName: "",
      address: ""
    },
    publicDraftMode: true,
    displayToken: createPublicDisplayToken(),
    clientValues: {
      purchaser: "",
      purchaser_contact: "",
      contact_email: "",
      contact_phone: "",
      project_name: "",
      site_name: "",
      address: ""
    },
    sections: buildSpecificationRenderModel(specification),
    documents: [],
    reviewUrl: "",
    uploadUrl: "",
    documentsEnabled: false,
    docsMaxCount: MAX_DOCS_PER_EQUIPMENT,
    docsMaxSizeBytes: MAX_DOC_SIZE_BYTES,
    errors: {},
    clientErrors: {},
    saved: false,
    qrDataUrl: "",
    qrDataUrlSoft: "",
    qrDataUrlVextrom: "",
    csrfToken: req.csrfToken()
  });
}));

app.post("/form/public/:linkSlug/:draftToken/specification", csrfProtection, asyncHandler(async (req, res) => {
  const linkSlug = sanitizeInput(req.params.linkSlug);
  const draftToken = sanitizeInput(req.params.draftToken);
  if (!isValidPublicDraftToken(draftToken)) {
    return sendStandardError(req, res, 404);
  }

  const link = await getPublicTokenLinkBySlug(linkSlug);
  if (!link || !link.isActive) {
    return sendStandardError(req, res, 404);
  }

  const clientData = parseClientDataFromBody(req.body);
  const clientErrors = validateClientData(clientData, req.t);
  const specification = await getSpecificationTemplateForProfile(link.profileId);
  const allFields = specification.sections.flatMap((section) => section.fields);
  const parsed = parseSpecificationFormBody(allFields, req.body);

  if (Object.keys(parsed.errors).length > 0 || Object.keys(clientErrors).length > 0) {
    return res.status(422).render("section", {
      pageTitle: req.t("section.headerTitle"),
      equipment: {
        id: null,
        token: draftToken,
        purchaser: "",
        purchaserContact: "",
        contactEmail: "",
        contactPhone: "",
        projectName: "",
        siteName: "",
        address: ""
      },
      publicDraftMode: true,
      displayToken: createPublicDisplayToken(),
      clientValues: {
        purchaser: clientData.purchaser,
        purchaser_contact: clientData.purchaserContact,
        contact_email: clientData.contactEmail,
        contact_phone: clientData.contactPhone,
        project_name: clientData.projectName,
        site_name: clientData.siteName,
        address: clientData.address
      },
      sections: buildSpecificationRenderModel(specification, parsed.submittedValues),
      documents: [],
      reviewUrl: "",
      uploadUrl: "",
      documentsEnabled: false,
      docsMaxCount: MAX_DOCS_PER_EQUIPMENT,
      docsMaxSizeBytes: MAX_DOC_SIZE_BYTES,
      errors: parsed.errors,
      clientErrors,
      saved: false,
      qrDataUrl: "",
      qrDataUrlSoft: "",
      qrDataUrlVextrom: "",
      csrfToken: req.csrfToken()
    });
  }

  const enabledFieldIds = await getProfileFieldIds(link.profileId);
  const equipment = await createEquipment({
    purchaser: clientData.purchaser,
    purchaserContact: clientData.purchaserContact,
    contactEmail: clientData.contactEmail,
    contactPhone: clientData.contactPhone,
    projectName: clientData.projectName,
    siteName: clientData.siteName,
    address: clientData.address,
    profileId: link.profileId,
    enabledFieldIds
  });
  await saveEquipmentSpecification(equipment.id, parsed.values);

  if (sanitizeInput(req.body.action) === "review") {
    return res.redirect(`/form/${equipment.token}/review`);
  }
  return res.redirect(`/form/${equipment.token}/specification?saved=1`);
}));

app.get("/form/public/:draftToken/specification", csrfProtection, asyncHandler(async (req, res) => {
  const draftToken = sanitizeInput(req.params.draftToken);
  if (!isValidPublicDraftToken(draftToken)) {
    return sendStandardError(req, res, 404);
  }

  const specification = await getSpecificationTemplate(req.lang);
  res.render("section", {
    pageTitle: req.t("section.headerTitle"),
    equipment: {
      id: null,
      token: draftToken,
      purchaser: "",
      purchaserContact: "",
      contactEmail: "",
      contactPhone: "",
      projectName: "",
      siteName: "",
      address: ""
    },
    publicDraftMode: true,
    displayToken: createPublicDisplayToken(),
    clientValues: {
      purchaser: "",
      purchaser_contact: "",
      contact_email: "",
      contact_phone: "",
      project_name: "",
      site_name: "",
      address: ""
    },
    sections: buildSpecificationRenderModel(specification),
    documents: [],
    reviewUrl: "",
    uploadUrl: "",
    documentsEnabled: false,
    docsMaxCount: MAX_DOCS_PER_EQUIPMENT,
    docsMaxSizeBytes: MAX_DOC_SIZE_BYTES,
    errors: {},
    clientErrors: {},
    saved: false,
    qrDataUrl: "",
    qrDataUrlSoft: "",
    qrDataUrlVextrom: "",
    csrfToken: req.csrfToken()
  });
}));

app.post("/form/public/:draftToken/specification", csrfProtection, asyncHandler(async (req, res) => {
  const draftToken = sanitizeInput(req.params.draftToken);
  if (!isValidPublicDraftToken(draftToken)) {
    return sendStandardError(req, res, 404);
  }

  const clientData = parseClientDataFromBody(req.body);
  const clientErrors = validateClientData(clientData, req.t);
  const specification = await getSpecificationTemplate(req.lang);
  const allFields = specification.sections.flatMap((section) => section.fields);
  const parsed = parseSpecificationFormBody(allFields, req.body);

  if (Object.keys(parsed.errors).length > 0 || Object.keys(clientErrors).length > 0) {
    return res.status(422).render("section", {
      pageTitle: req.t("section.headerTitle"),
      equipment: {
        id: null,
        token: draftToken,
        purchaser: "",
        purchaserContact: "",
        contactEmail: "",
        contactPhone: "",
        projectName: "",
        siteName: "",
        address: ""
      },
      publicDraftMode: true,
      displayToken: createPublicDisplayToken(),
      clientValues: {
        purchaser: clientData.purchaser,
        purchaser_contact: clientData.purchaserContact,
        contact_email: clientData.contactEmail,
        contact_phone: clientData.contactPhone,
        project_name: clientData.projectName,
        site_name: clientData.siteName,
        address: clientData.address
      },
      sections: buildSpecificationRenderModel(specification, parsed.submittedValues),
      documents: [],
      reviewUrl: "",
      uploadUrl: "",
      documentsEnabled: false,
      docsMaxCount: MAX_DOCS_PER_EQUIPMENT,
      docsMaxSizeBytes: MAX_DOC_SIZE_BYTES,
      errors: parsed.errors,
      clientErrors,
      saved: false,
      qrDataUrl: "",
      qrDataUrlSoft: "",
      qrDataUrlVextrom: "",
      csrfToken: req.csrfToken()
    });
  }

  const equipment = await createEquipment({
    purchaser: clientData.purchaser,
    purchaserContact: clientData.purchaserContact,
    contactEmail: clientData.contactEmail,
    contactPhone: clientData.contactPhone,
    projectName: clientData.projectName,
    siteName: clientData.siteName,
    address: clientData.address
  });
  await saveEquipmentSpecification(equipment.id, parsed.values);

  if (sanitizeInput(req.body.action) === "review") {
    return res.redirect(`/form/${equipment.token}/review`);
  }
  return res.redirect(`/form/${equipment.token}/specification?saved=1`);
}));

app.post("/admin/seed-annexd", csrfProtection, requireAdminAuth, asyncHandler(async (_req, res) => {
  await seedAnnexDFields({ overwrite: true });
  res.redirect("/admin/fields?saved=1");
}));

if (env.reportServiceEnabled) {
  registerReportService(app, {
    asyncHandler,
    sanitizeInput,
    sanitizeRichTextInput,
    reviseTextWithAi,
    requireApiScope,
    requireAdminAuth,
    csrfProtection
  });
}

if (env.moduleSpecEnabled && registerModuleSpec) {
  registerModuleSpec(app, {
    asyncHandler,
    requireApiScope
  });
}

app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    return sendStandardError(req, res, 403);
  }
  if (req.path.includes("/docs/upload") && err.type === "entity.too.large") {
    return res.status(413).json({
      error: "File exceeds maximum size.",
      errorCode: "DOC_FILE_TOO_LARGE",
      details: null
    });
  }
  if (
    (req.path.includes("/admin/maintenance/restore-import") || req.path.includes("/admin/maintenance/system/restore-import"))
    && err.type === "entity.too.large"
  ) {
    return res.status(413).json({
      ok: false,
      code: -1,
      label: "npm run db:restore-database -- <arquivo.sql>",
      output: `Arquivo SQL excede limite de ${(MAINTENANCE_IMPORT_MAX_SQL_BYTES / (1024 * 1024)).toFixed(0)} MB.`
    });
  }
  if (
    err.statusCode &&
    (
      req.path.startsWith("/fields")
      || req.path.startsWith("/equipment/")
      || req.path.startsWith("/api/report-service/")
      || req.path.startsWith("/api/module-spec/")
      || req.path.includes("/docs/upload")
      || req.path.includes("/admin/maintenance/restore-import")
      || req.path.includes("/admin/maintenance/system/restore-import")
    )
  ) {
    const message = getStandardStatusMessage(req, err.statusCode);
    return res.status(err.statusCode).json({
      error: message,
      errorCode: err.errorCode || null,
      details: null
    });
  }
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);
  if (
    req.path.startsWith("/fields")
    || req.path.startsWith("/equipment/")
    || req.path.startsWith("/api/report-service/")
    || req.path.startsWith("/api/module-spec/")
    || req.path.includes("/docs/upload")
    || req.path.includes("/admin/maintenance/restore-import")
    || req.path.includes("/admin/maintenance/system/restore-import")
  ) {
    return res.status(err.statusCode || 500).json({
      error: getStandardStatusMessage(req, err.statusCode || 500),
      errorCode: err.errorCode || null,
      details: null
    });
  }
  return res.status(err.statusCode || 500).send(getStandardStatusMessage(req, err.statusCode || 500));
});

async function initializeSpecflow() {
  await migrate();
  await seedAnnexDFields();
}

function startSpecflowServer() {
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on ${env.appBaseUrl}`);
  });
}

module.exports = {
  app,
  initializeSpecflow,
  startSpecflowServer
};

if (require.main === module) {
  initializeSpecflow()
    .then(() => {
      startSpecflowServer();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Startup failed:", err.message);
      process.exit(1);
    });
}

