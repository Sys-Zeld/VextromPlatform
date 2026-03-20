const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const env = require("../specflow/config/env");
const db = require("../specflow/db");
const { upsertBackupFileRecord } = require("../specflow/services/backups");
const { resolvePostgresCommand, buildNotFoundHint } = require("./utils/postgres-cli");

function buildBackupPath() {
  const backupDir = path.join(process.cwd(), "dados", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(backupDir, `db-backup-${timestamp}.sql`);
}

async function runPgDump(databaseUrl, outputFile) {
  await new Promise((resolve, reject) => {
    const pgDumpCommand = resolvePostgresCommand("pg_dump");
    const args = [
      "--no-owner",
      "--no-privileges",
      "--exclude-table-data=public.backup_files",
      "--file",
      outputFile,
      databaseUrl
    ];
    const child = spawn(
      pgDumpCommand,
      args,
      {
        stdio: "inherit",
        shell: false,
        windowsHide: true
      }
    );

    child.on("error", (err) => {
      if (err && err.code === "ENOENT") {
        reject(new Error(buildNotFoundHint("pg_dump")));
        return;
      }
      reject(new Error(`Falha ao iniciar pg_dump: ${err.message}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pg_dump retornou codigo ${code}.`));
    });
  });
}

async function run() {
  const databaseUrl = env.database.url;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL nao configurado.");
  }

  const outputFile = buildBackupPath();
  await runPgDump(databaseUrl, outputFile);
  const backupRow = await upsertBackupFileRecord(outputFile, { backupTimestamp: new Date() });
  // eslint-disable-next-line no-console
  console.log(`Backup concluido: ${outputFile}`);
  // eslint-disable-next-line no-console
  console.log(`Backup registrado no catalogo: id=${backupRow.id}`);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha no backup:", err.message);
  process.exit(1);
}).finally(async () => {
  try {
    await db.end();
  } catch (_err) {
    // noop
  }
});

