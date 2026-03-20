const fs = require("fs");
const path = require("path");

function isWindows() {
  return process.platform === "win32";
}

function getExecutableName(baseName) {
  return isWindows() ? `${baseName}.exe` : baseName;
}

function isPositiveVersionFolder(name) {
  return /^\d+(\.\d+)?$/.test(String(name || "").trim());
}

function compareVersionsDesc(a, b) {
  const aParts = String(a).split(".").map((part) => Number(part) || 0);
  const bParts = String(b).split(".").map((part) => Number(part) || 0);
  const max = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < max; index += 1) {
    const diff = (bParts[index] || 0) - (aParts[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function listVersionedBinCandidates(baseDir) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch (_err) {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && isPositiveVersionFolder(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersionsDesc)
    .map((versionName) => path.join(baseDir, versionName, "bin"));
}

function resolvePostgresCommand(baseName) {
  const executableName = getExecutableName(baseName);
  const preferredBinDir = String(process.env.PG_BIN_DIR || "").trim();
  const candidates = [];

  if (preferredBinDir) {
    candidates.push(path.resolve(preferredBinDir));
  }

  if (isWindows()) {
    candidates.push(...listVersionedBinCandidates("C:\\Program Files\\PostgreSQL"));
    candidates.push(...listVersionedBinCandidates("C:\\Program Files (x86)\\PostgreSQL"));
  }

  for (const binDir of candidates) {
    const resolved = path.join(binDir, executableName);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  // Fallback to PATH lookup.
  return baseName;
}

function buildNotFoundHint(baseName) {
  if (!isWindows()) {
    return `${baseName} nao encontrado no PATH. Instale os binarios cliente do PostgreSQL ou defina PG_BIN_DIR no .env (ex: /opt/bitnami/postgresql/bin).`;
  }
  return `${baseName} nao encontrado no PATH. Defina PG_BIN_DIR no .env apontando para a pasta 'bin' do PostgreSQL (ex: C:\\Program Files\\PostgreSQL\\17\\bin).`;
}

module.exports = {
  resolvePostgresCommand,
  buildNotFoundHint
};
