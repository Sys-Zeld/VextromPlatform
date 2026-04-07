const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Pool } = require("pg");
const env = require("../specflow/config/env");
const { resolvePostgresCommand, buildNotFoundHint } = require("./utils/postgres-cli");
const DEFAULT_RESTORE_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_SQL_SCAN_BYTES = 8 * 1024 * 1024;

const MODULE_CONFIG = {
  specflow: {
    dbUrl: env.databases.specflow.url,
    ssl: env.databases.specflow.ssl
  },
  config: {
    dbUrl: env.databases.config.url,
    ssl: env.databases.config.ssl
  },
  "module-spec": {
    dbUrl: env.databases.moduleSpec.url,
    ssl: env.databases.moduleSpec.ssl
  },
  "report-service": {
    dbUrl: env.databases.reportService.url,
    ssl: env.databases.reportService.ssl
  }
};

const MODULE_FILE_PREFIXES = {
  specflow: ["db-backup-", "specflow-backup-"],
  config: ["config-backup-"],
  "module-spec": ["module-spec-backup-"],
  "report-service": ["report-service-backup-"]
};

const MODULE_SQL_SIGNATURES = {
  specflow: [
    "create table public.fields",
    "create table public.equipments",
    "create table public.equipment_field_values",
    "create table public.public_token_links"
  ],
  config: [
    "create table public.admin_users"
  ],
  "module-spec": [
    "create table public.equipment_families",
    "create table public.equipment_models",
    "create table public.equipment_variants",
    "create table public.profile_filter_mappings"
  ],
  "report-service": [
    "create table public.service_report_orders",
    "create table public.service_report_reports",
    "create table public.service_report_sections",
    "create table public.service_report_app_settings"
  ]
};

function normalizeModuleName(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "specflow" || text === "config" || text === "module-spec" || text === "report-service") return text;
  return "";
}

function resolveModuleFromFlag() {
  const arg = process.argv.slice(2).find((item) => String(item).startsWith("--module="));
  if (!arg) return "";
  return normalizeModuleName(String(arg).slice("--module=".length));
}

function resolveModuleFromFileName(filePath) {
  const fileName = path.basename(String(filePath || "")).toLowerCase();
  const startsWithMatch = Object.keys(MODULE_FILE_PREFIXES).find((moduleName) => (
    MODULE_FILE_PREFIXES[moduleName].some((prefix) => fileName.startsWith(prefix))
  ));
  if (startsWithMatch) return startsWithMatch;

  if (fileName.startsWith("db-import-")) {
    const importEmbeddedMatch = Object.keys(MODULE_FILE_PREFIXES).find((moduleName) => (
      MODULE_FILE_PREFIXES[moduleName].some((prefix) => fileName.includes(`-${prefix}`))
    ));
    if (importEmbeddedMatch) return importEmbeddedMatch;
  }

  return "";
}

function resolveTargetModule({ moduleFromFlag, backupFilePath, strict = true }) {
  const fromFlag = normalizeModuleName(moduleFromFlag);
  const fromFile = resolveModuleFromFileName(backupFilePath);

  if (fromFlag && fromFile && fromFlag !== fromFile) {
    throw new Error(
      `Conflito de modulo: --module=${fromFlag} mas arquivo parece ser ${fromFile} (${path.basename(backupFilePath)}).`
    );
  }
  if (fromFlag) return fromFlag;
  if (fromFile) return fromFile;

  if (strict) {
    throw new Error(
      "Nao foi possivel identificar o modulo pelo nome do arquivo. "
      + "Use --module=specflow|config|module-spec|report-service."
    );
  }
  return "specflow";
}

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

function resolveSqlScanBytes() {
  const raw = Number(process.env.DB_RESTORE_SCAN_BYTES || DEFAULT_SQL_SCAN_BYTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SQL_SCAN_BYTES;
  return Math.floor(raw);
}

function readSqlSample(filePath, maxBytes) {
  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    const bytesToRead = Math.max(1024, Math.min(maxBytes, stat.size));
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, 0);
    return buffer.toString("utf8", 0, bytesRead).toLowerCase();
  } finally {
    fs.closeSync(fd);
  }
}

function detectModuleFromSqlFile(filePath) {
  const scanBytes = resolveSqlScanBytes();
  const sample = readSqlSample(filePath, scanBytes);
  const hits = Object.fromEntries(
    Object.keys(MODULE_SQL_SIGNATURES).map((moduleName) => [moduleName, 0])
  );

  for (const [moduleName, signatures] of Object.entries(MODULE_SQL_SIGNATURES)) {
    for (const signature of signatures) {
      if (sample.includes(signature)) {
        hits[moduleName] += 1;
      }
    }
  }

  const hasReportService = hits["report-service"] >= 1;
  const hasModuleSpec = hits["module-spec"] >= 1;
  const hasSpecflow = hits.specflow >= 2;
  const hasConfigOnly = hits.config >= 1 && !hasReportService && !hasModuleSpec && !hasSpecflow;
  const detectedModules = [];

  if (hasSpecflow) detectedModules.push("specflow");
  if (hasConfigOnly) detectedModules.push("config");
  if (hasModuleSpec) detectedModules.push("module-spec");
  if (hasReportService) detectedModules.push("report-service");

  if (detectedModules.length === 1) {
    return {
      module: detectedModules[0],
      hits,
      mixed: false
    };
  }

  return {
    module: "",
    hits,
    mixed: detectedModules.length > 1,
    detectedModules
  };
}

function validateRestoreModule({ moduleFromFlag, targetModule, backupFilePath }) {
  const moduleByFileName = resolveModuleFromFileName(backupFilePath);
  const signatureResult = detectModuleFromSqlFile(backupFilePath);
  const moduleBySqlSignature = signatureResult.module;
  const normalizedFlag = normalizeModuleName(moduleFromFlag);
  const displayName = path.basename(backupFilePath);

  if (signatureResult.mixed) {
    const targetIsPresent = signatureResult.detectedModules.includes(targetModule);
    const hasExplicitModule = Boolean(normalizedFlag || moduleByFileName);

    if (!targetIsPresent) {
      throw new Error(
        `Backup misto detectado em ${displayName}: assinaturas de ${signatureResult.detectedModules.join(", ")}. `
        + `O modulo alvo (${targetModule}) nao foi encontrado no arquivo.`
      );
    }

    if (!hasExplicitModule) {
      throw new Error(
        `Backup misto detectado em ${displayName}: assinaturas de ${signatureResult.detectedModules.join(", ")}. `
        + "Use --module=specflow|config|module-spec|report-service para identificar o modulo alvo."
      );
    }

    // eslint-disable-next-line no-console
    console.warn(
      `Aviso: backup misto em ${displayName} contem tabelas de: ${signatureResult.detectedModules.join(", ")}. `
      + `Restaurando apenas para o banco ${targetModule}. `
      + "Para dumps separados por modulo use: npm run db:backup:<modulo>"
    );
    return;
  }

  if (moduleByFileName && moduleBySqlSignature && moduleByFileName !== moduleBySqlSignature) {
    throw new Error(
      `Arquivo de backup inconsistente (${displayName}): prefixo indica ${moduleByFileName}, `
      + `mas o conteudo SQL parece ${moduleBySqlSignature}.`
    );
  }

  if (moduleBySqlSignature && moduleBySqlSignature !== targetModule) {
    throw new Error(
      `Restore bloqueado: arquivo ${displayName} parece ser ${moduleBySqlSignature}, `
      + `mas o destino selecionado e ${targetModule}.`
    );
  }

  if (normalizedFlag && moduleBySqlSignature && normalizedFlag !== moduleBySqlSignature) {
    throw new Error(
      `Conflito de modulo: --module=${normalizedFlag}, mas o SQL parece ${moduleBySqlSignature} (${displayName}).`
    );
  }

  if (!moduleBySqlSignature) {
    if (!moduleByFileName && !normalizedFlag) {
      throw new Error(
        `Nao foi possivel identificar o modulo de ${displayName} pelo conteudo SQL nem pelo nome do arquivo. `
        + "Use --module=specflow|config|module-spec|report-service."
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      `Aviso: assinaturas SQL nao encontradas em ${displayName} (banco vazio ou scan insuficiente). `
      + `Prosseguindo com modulo identificado por ${normalizedFlag ? "--module" : "nome do arquivo"}: ${targetModule}.`
    );
  }
}

function shouldSkipClean() {
  return process.argv.includes("--no-clean");
}

function isSqlBackupFile(fileName, targetModule) {
  const normalized = String(fileName || "").toLowerCase();
  if (!normalized.endsWith(".sql")) return false;
  const prefixes = MODULE_FILE_PREFIXES[targetModule] || [];
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function findLatestBackup(targetModule) {
  const backupDir = path.join(process.cwd(), "dados", "backups");
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Diretorio de backups nao encontrado: ${backupDir}`);
  }

  const files = fs
    .readdirSync(backupDir)
    .filter((file) => isSqlBackupFile(file, targetModule))
    .map((file) => {
      const fullPath = path.join(backupDir, file);
      const stat = fs.statSync(fullPath);
      const match = file.match(
        /-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sql$/i
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
    throw new Error(`Nenhum backup .sql encontrado para o modulo ${targetModule} em: ${backupDir}`);
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

async function resetPublicSchema(moduleName) {
  const config = MODULE_CONFIG[moduleName];
  if (!config || !config.dbUrl) {
    throw new Error(`URL de banco nao configurada para modulo: ${moduleName}.`);
  }

  const pool = new Pool({
    connectionString: config.dbUrl,
    ssl: config.ssl ? { rejectUnauthorized: false } : false
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE;");
    await client.query("CREATE SCHEMA public;");
    await client.query("GRANT ALL ON SCHEMA public TO CURRENT_USER;");
    await client.query("GRANT ALL ON SCHEMA public TO public;");
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackErr) {
      // noop
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function run() {
  const moduleFromFlag = resolveModuleFromFlag();
  if (moduleFromFlag === "") {
    const hasModuleFlag = process.argv.slice(2).some((arg) => String(arg).startsWith("--module="));
    if (hasModuleFlag) {
      throw new Error("Modulo invalido em --module. Use: specflow | config | module-spec | report-service.");
    }
  }

  const manualBackup = resolveBackupFileFromArgs();
  let targetModule = "specflow";
  let backupFile = manualBackup;

  if (backupFile) {
    targetModule = resolveTargetModule({
      moduleFromFlag,
      backupFilePath: backupFile,
      strict: true
    });
  } else {
    targetModule = moduleFromFlag || "specflow";
    backupFile = findLatestBackup(targetModule);
  }

  const databaseUrl = MODULE_CONFIG[targetModule] && MODULE_CONFIG[targetModule].dbUrl;
  if (!databaseUrl) {
    throw new Error(`URL de banco nao configurada para modulo: ${targetModule}.`);
  }

  const skipClean = shouldSkipClean();

  validateRestoreModule({
    moduleFromFlag,
    targetModule,
    backupFilePath: backupFile
  });

  if (!skipClean) {
    // eslint-disable-next-line no-console
    console.log(`Limpando schema public antes do restore (${targetModule})...`);
    await resetPublicSchema(targetModule);
  }

  // eslint-disable-next-line no-console
  console.log(`Restaurando backup (${targetModule}): ${backupFile}`);
  await runPsql(databaseUrl, backupFile);
  // eslint-disable-next-line no-console
  console.log("Restore concluido com sucesso.");
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Falha no restore:", err.message);
  process.exit(1);
});

