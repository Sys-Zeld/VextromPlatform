const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const env = require("../specflow/config/env");
const db = require("../specflow/db");
const { resolvePostgresCommand, buildNotFoundHint } = require("./utils/postgres-cli");
const DEFAULT_RESTORE_TIMEOUT_MS = 20 * 60 * 1000;

function resolveBackupFileFromArgs() {
  const argPath = process.argv.slice(2).find((arg) => arg && !String(arg).startsWith("--"));
  if (!argPath) return null;

  const resolved = path.resolve(argPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Arquivo de backup nao encontrado: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Caminho informado nao e arquivo: ${resolved}`);
  }

  return resolved;
}

function shouldSkipClean() {
  return process.argv.includes("--no-clean");
}

function findLatestBackup() {
  const backupDir = path.join(process.cwd(), "dados", "backups");
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Diretorio de backups nao encontrado: ${backupDir}`);
  }

  const files = fs
    .readdirSync(backupDir)
    .filter((file) => file.toLowerCase().endsWith(".sql"))
    .map((file) => {
      const fullPath = path.join(backupDir, file);
      const stat = fs.statSync(fullPath);
      const match = file.match(
        /^db-backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sql$/i
      );
      const nameDateMs = match
        ? Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`)
        : null;

      return {
        fullPath,
        mtimeMs: stat.mtimeMs,
        name: file,
        isFile: stat.isFile(),
        nameDateMs
      };
    })
    .filter((entry) => entry.isFile);

  if (!files.length) {
    throw new Error(`Nenhum arquivo .sql encontrado em: ${backupDir}`);
  }

  files.sort((a, b) => {
    if (a.nameDateMs !== null || b.nameDateMs !== null) {
      const aDate = a.nameDateMs === null ? -Infinity : a.nameDateMs;
      const bDate = b.nameDateMs === null ? -Infinity : b.nameDateMs;
      if (bDate !== aDate) return bDate - aDate;
    }
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return b.name.localeCompare(a.name);
  });

  return files[0].fullPath;
}

function resolveRestoreTimeoutMs() {
  const raw = Number(process.env.DB_RESTORE_TIMEOUT_MS || DEFAULT_RESTORE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RESTORE_TIMEOUT_MS;
  return Math.floor(raw);
}

async function runPsql(databaseUrl, inputFile) {
  await new Promise((resolve, reject) => {
    const psqlCommand = resolvePostgresCommand("psql");
    const timeoutMs = resolveRestoreTimeoutMs();
    let settled = false;
    const child = spawn(
      psqlCommand,
      ["-v", "ON_ERROR_STOP=1", "--single-transaction", "--echo-errors", "--file", inputFile, databaseUrl],
      {
        stdio: "inherit",
        shell: false,
        windowsHide: true
      }
    );
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(
        `Timeout no restore apos ${Math.floor(timeoutMs / 1000)}s. `
        + "Verifique locks/conexao e tente novamente (ou ajuste DB_RESTORE_TIMEOUT_MS)."
      ));
    }, timeoutMs);

    function finishWith(handler) {
      return (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        handler(value);
      };
    }

    child.on("error", finishWith((err) => {
      if (err && err.code === "ENOENT") {
        reject(new Error(buildNotFoundHint("psql")));
        return;
      }
      reject(new Error(`Falha ao iniciar psql: ${err.message}`));
    }));

    child.on("exit", finishWith((code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`psql retornou codigo ${code}.`));
    }));
  });
}

async function resetPublicSchema() {
  await db.query("BEGIN");
  try {
    await db.query("DROP SCHEMA IF EXISTS public CASCADE;");
    await db.query("CREATE SCHEMA public;");
    await db.query("GRANT ALL ON SCHEMA public TO CURRENT_USER;");
    await db.query("GRANT ALL ON SCHEMA public TO public;");
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

async function run() {
  const databaseUrl = env.database.url;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL nao configurado.");
  }

  const manualBackup = resolveBackupFileFromArgs();
  const backupFile = manualBackup || findLatestBackup();
  const skipClean = shouldSkipClean();

  if (!skipClean) {
    // eslint-disable-next-line no-console
    console.log("Limpando schema public antes do restore...");
    await resetPublicSchema();
  }

  // eslint-disable-next-line no-console
  console.log(`Restaurando backup: ${backupFile}`);
  await runPsql(databaseUrl, backupFile);
  // eslint-disable-next-line no-console
  console.log("Restore concluido com sucesso.");
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha no restore:", err.message);
  process.exit(1);
}).finally(async () => {
  try {
    await db.end();
  } catch (_err) {
    // noop
  }
});

