const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const env = require("../specflow/config/env");
const { resolvePostgresCommand, buildNotFoundHint } = require("./utils/postgres-cli");

const MODULE_CONFIG = {
  specflow: {
    dbUrl: env.databases.specflow.url,
    filePrefix: "specflow-backup"
  },
  config: {
    dbUrl: env.databases.config.url,
    filePrefix: "config-backup"
  },
  "module-spec": {
    dbUrl: env.databases.moduleSpec.url,
    filePrefix: "module-spec-backup"
  },
  "report-service": {
    dbUrl: env.databases.reportService.url,
    filePrefix: "report-service-backup"
  }
};

function buildBackupPath(prefix) {
  const backupDir = path.join(process.cwd(), "dados", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(backupDir, `${prefix}-${timestamp}.sql`);
}

function runPgDump(databaseUrl, outputFile) {
  return new Promise((resolve, reject) => {
    const pgDumpCommand = resolvePostgresCommand("pg_dump");
    const args = [
      "--no-owner",
      "--no-privileges",
      "--file",
      outputFile,
      databaseUrl
    ];

    const child = spawn(pgDumpCommand, args, {
      stdio: "inherit",
      shell: false,
      windowsHide: true
    });

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

function normalizeTargets(rawTarget) {
  const target = String(rawTarget || "").trim().toLowerCase();
  if (!target || target === "all") {
    return ["specflow", "config", "module-spec", "report-service"];
  }
  if (!Object.prototype.hasOwnProperty.call(MODULE_CONFIG, target)) {
    throw new Error("Modulo invalido. Use: specflow | config | module-spec | report-service | all.");
  }
  return [target];
}

async function run() {
  const targets = normalizeTargets(process.argv[2]);

  for (const target of targets) {
    const config = MODULE_CONFIG[target];
    if (!config || !config.dbUrl) {
      throw new Error(`URL de banco nao configurada para modulo: ${target}.`);
    }
    const outputFile = buildBackupPath(config.filePrefix);
    await runPgDump(config.dbUrl, outputFile);
    // eslint-disable-next-line no-console
    console.log(`Backup ${target} concluido: ${outputFile}`);
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha no backup por modulo:", err.message);
  process.exit(1);
});
