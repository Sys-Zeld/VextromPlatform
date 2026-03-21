const { Pool } = require("pg");
const env = require("../specflow/config/env");

function resolveModuleConfig(moduleNameRaw) {
  const moduleName = String(moduleNameRaw || "").trim().toLowerCase();
  if (moduleName === "module-spec") {
    return {
      label: "Module Spec",
      connectionString: env.databases.moduleSpec.url,
      ssl: env.databases.moduleSpec.ssl
    };
  }
  if (moduleName === "report-service") {
    return {
      label: "Report Service",
      connectionString: env.databases.reportService.url,
      ssl: env.databases.reportService.ssl
    };
  }
  if (moduleName === "specflow") {
    return {
      label: "SpecFlow",
      connectionString: env.databases.specflow.url,
      ssl: env.databases.specflow.ssl
    };
  }
  return null;
}

async function resetSchema(moduleName) {
  const config = resolveModuleConfig(moduleName);
  if (!config) {
    throw new Error("Modulo invalido. Use: specflow | module-spec | report-service");
  }

  const pool = new Pool({
    connectionString: config.connectionString,
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
    // eslint-disable-next-line no-console
    console.log(`Schema public recriado com sucesso (${config.label}).`);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackErr) {
      // no-op
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  const moduleName = process.argv[2] || "";
  resetSchema(moduleName)
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Falha ao recriar schema public:", err.message);
      process.exit(1);
    });
}

module.exports = {
  resetSchema
};

