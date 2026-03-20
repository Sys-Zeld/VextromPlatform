const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env") });

function normalizeAppBaseUrl(raw, options = {}) {
  const isProduction = Boolean(options.isProduction);
  const fallback = "http://localhost:3000";
  const candidate = String(raw || fallback).trim();
  try {
    const parsed = new URL(candidate);
    if (isProduction && parsed.port === "3000") {
      parsed.port = "";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch (_err) {
    return fallback;
  }
}

const nodeEnv = String(process.env.NODE_ENV || "development").toLowerCase();
const appBaseUrl = normalizeAppBaseUrl(process.env.APP_BASE_URL, {
  isProduction: nodeEnv === "production"
});

function resolveBaseDatabaseUrl() {
  return process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/dbspeflow";
}

function withDatabaseName(connectionString, databaseName) {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

const baseDatabaseUrl = resolveBaseDatabaseUrl();
const defaultDatabaseSsl = parseBooleanFlag(process.env.DATABASE_SSL, false);
const specflowDatabaseUrl = process.env.SPECFLOW_DATABASE_URL || baseDatabaseUrl;
const moduleSpecDatabaseUrl = process.env.MODULE_SPEC_DATABASE_URL || withDatabaseName(baseDatabaseUrl, "dbmodulespec");
const reportServiceDatabaseUrl = process.env.REPORT_SERVICE_DATABASE_URL || withDatabaseName(baseDatabaseUrl, "reportservice");

module.exports = {
  nodeEnv,
  port: Number(process.env.PORT || 3000),
  appBaseUrl,
  specflowEnabled: String(process.env.SPECFLOW_ENABLED || "true").toLowerCase() === "true",
  moduleSpecEnabled: String(process.env.MODULE_SPEC_ENABLED || "false").toLowerCase() === "true",
  reportServiceEnabled: String(process.env.REPORT_SERVICE_ENABLED || "true").toLowerCase() === "true",
  admin: {
    user: process.env.ADMIN_USER || "admin",
    pass: process.env.ADMIN_PASS || "change-me",
    sessionSecret: process.env.ADMIN_SESSION_SECRET || "change-me-too",
    sessionCookieName: process.env.ADMIN_SESSION_COOKIE_NAME || "admin_session",
    sessionTtlHours: Math.max(1, Number(process.env.ADMIN_SESSION_TTL_HOURS || 12)),
    sessionStateFile: process.env.ADMIN_SESSION_STATE_FILE || path.join(process.cwd(), "dados", "admin-session-state.json"),
    usersFile: process.env.ADMIN_USERS_FILE || path.join(process.cwd(), "dados", "admin-users.json")
  },
  database: {
    // Backward-compatible alias for legacy scripts that still read env.database.
    url: specflowDatabaseUrl,
    ssl: parseBooleanFlag(process.env.SPECFLOW_DATABASE_SSL, defaultDatabaseSsl)
  },
  databases: {
    specflow: {
      url: specflowDatabaseUrl,
      ssl: parseBooleanFlag(process.env.SPECFLOW_DATABASE_SSL, defaultDatabaseSsl)
    },
    moduleSpec: {
      url: moduleSpecDatabaseUrl,
      ssl: parseBooleanFlag(process.env.MODULE_SPEC_DATABASE_SSL, defaultDatabaseSsl)
    },
    reportService: {
      url: reportServiceDatabaseUrl,
      ssl: parseBooleanFlag(process.env.REPORT_SERVICE_DATABASE_SSL, defaultDatabaseSsl)
    }
  },
  smtp: {
    host: process.env.SMTP_HOST || process.env.MAILTRAP_SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || process.env.MAILTRAP_SMTP_PORT || 587),
    secure:
      String(process.env.SMTP_SECURE || process.env.MAILTRAP_SMTP_SECURE || "false").toLowerCase() === "true",
    user:
      process.env.SMTP_USER ||
      process.env.MAILTRAP_SMTP_USER ||
      (process.env.MAILTRAP_API_TOKEN ? "api" : ""),
    pass:
      process.env.SMTP_PASS || process.env.MAILTRAP_SMTP_PASS || process.env.MAILTRAP_API_TOKEN || "",
    from: process.env.SMTP_FROM || process.env.MAILTRAP_FROM || "no-reply@example.com"
  },
  apiKeys: {
    pepper: process.env.API_KEY_PEPPER || process.env.ADMIN_SESSION_SECRET || "change-me-too",
    defaultTtlDays: Math.max(1, Number(process.env.API_KEY_DEFAULT_TTL_DAYS || 365))
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    baseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    maxOutputTokens: Math.max(1000, Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 8000)),
    maxOutputRetries: Math.max(0, Number(process.env.OPENAI_MAX_OUTPUT_RETRIES || 2)),
    maxOutputTokensCap: Math.max(1000, Number(process.env.OPENAI_MAX_OUTPUT_TOKENS_CAP || 20000))
  },
  storage: {
    docsDir: process.env.DOCS_DIR || path.join(process.cwd(), "dados", "docs")
  }
};
