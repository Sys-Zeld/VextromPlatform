const fs = require("fs");
const path = require("path");
const env = require("../specflow/config/env");

const ROOT_DIR = process.cwd();
const KEEP_BASENAMES = new Set([".gitkeep", ".keep"]);

const TARGET_DIRS = [
  {
    label: "docs (specflow)",
    dirPath: path.resolve(env.storage.docsDir)
  },
  {
    label: "service-report-pdfs",
    dirPath: path.join(ROOT_DIR, "dados", "service-report-pdfs")
  },
  {
    label: "service-report-html",
    dirPath: path.join(ROOT_DIR, "dados", "service-report-html")
  },
  {
    label: "report img (docs/report/img)",
    dirPath: path.join(ROOT_DIR, "docs", "report", "img")
  }
];

function isInsideRoot(targetPath) {
  const relative = path.relative(ROOT_DIR, targetPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function cleanDirectoryContents(dirPath) {
  if (!isInsideRoot(dirPath)) {
    throw new Error(`Destino fora do projeto bloqueado: ${dirPath}`);
  }

  fs.mkdirSync(dirPath, { recursive: true });
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let removedCount = 0;

  for (const entry of entries) {
    if (KEEP_BASENAMES.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    fs.rmSync(fullPath, { recursive: true, force: true });
    removedCount += 1;
  }

  return removedCount;
}

function run() {
  let totalRemoved = 0;

  for (const target of TARGET_DIRS) {
    const removed = cleanDirectoryContents(target.dirPath);
    totalRemoved += removed;
    // eslint-disable-next-line no-console
    console.log(`Limpo: ${target.label} -> ${target.dirPath} (${removed} item(ns) removido(s))`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nLimpeza de assets concluida. Total removido: ${totalRemoved} item(ns).`);
}

try {
  run();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("Falha na limpeza de assets:", err.message);
  process.exit(1);
}

