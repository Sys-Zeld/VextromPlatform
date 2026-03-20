const fs = require("fs");
const path = require("path");

const TARGETS = {
  all: ["SPECFLOW_ENABLED", "MODULE_SPEC_ENABLED", "REPORT_SERVICE_ENABLED"],
  specflow: ["SPECFLOW_ENABLED"],
  "module-spec": ["MODULE_SPEC_ENABLED"],
  "report-service": ["REPORT_SERVICE_ENABLED"]
};

function normalizeMode(rawMode) {
  const value = String(rawMode || "").trim().toLowerCase();
  if (["enable", "on", "true", "1"].includes(value)) return "enable";
  if (["disable", "off", "false", "0"].includes(value)) return "disable";
  return "";
}

function normalizeTarget(rawTarget) {
  const value = String(rawTarget || "all").trim().toLowerCase();
  return TARGETS[value] ? value : "";
}

function upsertEnvVar(content, key, value) {
  const lineBreak = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const targetPrefix = `${key}=`;
  let replaced = false;

  const updatedLines = lines.map((line) => {
    if (line.startsWith(targetPrefix)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!replaced) {
    if (updatedLines.length && updatedLines[updatedLines.length - 1] !== "") {
      updatedLines.push("");
    }
    updatedLines.push(`${key}=${value}`);
  }

  return updatedLines.join(lineBreak);
}

function run() {
  const mode = normalizeMode(process.argv[2]);
  const target = normalizeTarget(process.argv[3]);
  if (!mode || !target) {
    // eslint-disable-next-line no-console
    console.error("Uso: node scripts/modules-toggle.js <enable|disable> <all|specflow|module-spec|report-service>");
    process.exit(1);
  }

  const enabled = mode === "enable";
  const envFilePath = path.join(process.cwd(), ".env");
  let content = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, "utf8") : "";

  for (const key of TARGETS[target]) {
    content = upsertEnvVar(content, key, enabled ? "true" : "false");
  }

  fs.writeFileSync(envFilePath, content, "utf8");
  // eslint-disable-next-line no-console
  console.log(`${target}: ${enabled ? "enabled" : "disabled"}`);
  process.exit(0);
}

run();
