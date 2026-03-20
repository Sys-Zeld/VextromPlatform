const { spawnSync } = require("child_process");
const path = require("path");

const mode = String(process.argv[2] || "").trim().toLowerCase();
if (!["enable", "disable"].includes(mode)) {
  // eslint-disable-next-line no-console
  console.error("Uso: node scripts/module-spec-toggle.js <enable|disable>");
  process.exit(1);
}

const scriptPath = path.join(__dirname, "modules-toggle.js");
const result = spawnSync(process.execPath, [scriptPath, mode, "module-spec"], {
  stdio: "inherit",
  windowsHide: true
});
process.exit(Number.isInteger(result.status) ? result.status : 1);

