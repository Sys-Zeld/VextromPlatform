const fs = require("fs");
const path = require("path");
const env = require("../config/env");

const STATE_FILE = env.admin.sessionStateFile;
const STATE_DIR = path.dirname(STATE_FILE);
let cachedState = {};
let initialized = false;

function loadStateFromDiskSync() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  cachedState = loadStateFromDiskSync();
}

function persistStateSync(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function getAdminSessionNotBefore() {
  ensureInitialized();
  const value = Number(cachedState.adminSessionNotBefore || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function invalidateAllAdminSessions() {
  ensureInitialized();
  const now = Date.now();
  cachedState.adminSessionNotBefore = now;
  persistStateSync(cachedState);
  return now;
}

function getRateLimiterResetAfter() {
  ensureInitialized();
  const value = Number(cachedState.rateLimiterResetAfter || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function requestAllRateLimitersReset() {
  ensureInitialized();
  const now = Date.now();
  cachedState.rateLimiterResetAfter = now;
  persistStateSync(cachedState);
  return now;
}

module.exports = {
  getAdminSessionNotBefore,
  invalidateAllAdminSessions,
  getRateLimiterResetAfter,
  requestAllRateLimitersReset
};
