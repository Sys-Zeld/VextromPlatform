const fs = require("fs");
const path = require("path");
const env = require("../config/env");

const STATE_FILE = env.admin.sessionStateFile;
const STATE_DIR = path.dirname(STATE_FILE);
let cachedState = {};
let initialized = false;
let pendingWrite = Promise.resolve();

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

function persistStateAsync(state) {
  pendingWrite = pendingWrite
    .catch(() => {})
    .then(async () => {
      await fs.promises.mkdir(STATE_DIR, { recursive: true });
      await fs.promises.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
    })
    .catch(() => {});
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
  persistStateAsync(cachedState);
  return now;
}

module.exports = {
  getAdminSessionNotBefore,
  invalidateAllAdminSessions
};
