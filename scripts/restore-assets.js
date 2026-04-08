const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");

const ASSETS_BACKUP_PREFIX = "assets-backup-";

const ALLOWED_ZIP_FOLDERS = [
  "dados/docs",
  "dados/service-report-pdfs",
  "dados/service-report-html",
  "docs/report/img"
];

function resolveZipFileFromArgs() {
  const arg = process.argv.slice(2).find((item) => String(item).startsWith("--file="));
  if (arg) {
    const filePath = path.resolve(String(arg).slice("--file=".length).trim());
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo nao encontrado: ${filePath}`);
    }
    return filePath;
  }
  return null;
}

function findLatestAssetsBackup() {
  const backupDir = path.join(process.cwd(), "dados", "backups");
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Diretorio de backups nao encontrado: ${backupDir}`);
  }

  const files = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith(ASSETS_BACKUP_PREFIX) && f.endsWith(".zip"))
    .map((f) => {
      const fullPath = path.join(backupDir, f);
      return { fullPath, mtime: fs.statSync(fullPath).mtimeMs, name: f };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) {
    throw new Error(`Nenhum arquivo assets-backup-*.zip encontrado em: ${backupDir}`);
  }

  return files[0].fullPath;
}

function shouldSkipClean() {
  return process.argv.includes("--no-clean");
}

function isAllowedEntry(entryPath) {
  return ALLOWED_ZIP_FOLDERS.some(
    (folder) => entryPath === folder || entryPath.startsWith(folder + "/") || entryPath.startsWith(folder + "\\")
  );
}

async function extractZip(zipFile) {
  const directory = await unzipper.Open.file(zipFile);
  const skipClean = shouldSkipClean();

  if (!skipClean) {
    // Collect folders present in zip to selectively clean
    const foldersInZip = new Set();
    for (const entry of directory.files) {
      const entryPath = String(entry.path || "").replace(/\\/g, "/");
      const matched = ALLOWED_ZIP_FOLDERS.find(
        (folder) => entryPath === folder || entryPath.startsWith(folder + "/")
      );
      if (matched) foldersInZip.add(matched);
    }

    for (const folder of foldersInZip) {
      const destPath = path.join(process.cwd(), folder);
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
        // eslint-disable-next-line no-console
        console.log(`Limpando destino: ${destPath}`);
      }
    }
  }

  let extractedCount = 0;

  for (const entry of directory.files) {
    const entryPath = String(entry.path || "").replace(/\\/g, "/");

    if (!isAllowedEntry(entryPath)) continue;

    const destPath = path.join(process.cwd(), entryPath);

    if (entry.type === "Directory") {
      fs.mkdirSync(destPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    await new Promise((resolve, reject) => {
      entry.stream()
        .pipe(fs.createWriteStream(destPath))
        .on("finish", resolve)
        .on("error", reject);
    });

    extractedCount += 1;
  }

  return extractedCount;
}

async function run() {
  const manualFile = resolveZipFileFromArgs();
  const zipFile = manualFile || findLatestAssetsBackup();

  // eslint-disable-next-line no-console
  console.log(`Restaurando assets de: ${path.basename(zipFile)}`);

  const extractedCount = await extractZip(zipFile);

  // eslint-disable-next-line no-console
  console.log(`\nRestore de assets concluido: ${extractedCount} arquivo(s) extraido(s).`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha no restore de assets:", err.message);
  process.exit(1);
});
