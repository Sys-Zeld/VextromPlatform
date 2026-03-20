const fs = require("fs");
const path = require("path");
const env = require("../config/env");

function ensureStateDir() {
  const filePath = env.admin.sessionStateFile;
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readState() {
  try {
    const raw = fs.readFileSync(env.admin.sessionStateFile, "utf8");
    return JSON.parse(raw);
  } catch (_err) {
    return {};
  }
}

function writeState(state) {
  ensureStateDir();
  fs.writeFileSync(env.admin.sessionStateFile, JSON.stringify(state, null, 2), "utf8");
}

function getAdminSessionNotBefore() {
  const state = readState();
  const value = Number(state.adminSessionNotBefore || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function invalidateAllAdminSessions() {
  const now = Date.now();
  const state = readState();
  state.adminSessionNotBefore = now;
  writeState(state);
  return now;
}

module.exports = {
  getAdminSessionNotBefore,
  invalidateAllAdminSessions
};
