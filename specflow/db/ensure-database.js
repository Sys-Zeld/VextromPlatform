const { Client } = require("pg");

function escapeIdentifier(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function extractDatabaseName(connectionString) {
  const parsed = new URL(connectionString);
  const dbName = decodeURIComponent(String(parsed.pathname || "").replace(/^\/+/, "").trim());
  if (!dbName) {
    throw new Error("Database name missing in connection string.");
  }
  return dbName;
}

function toAdminConnectionString(connectionString) {
  const parsed = new URL(connectionString);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

async function ensureDatabaseExists({ connectionString, ssl = false }) {
  if (!connectionString) {
    throw new Error("connectionString is required to ensure database existence.");
  }

  const dbName = extractDatabaseName(connectionString);
  const adminConnectionString = toAdminConnectionString(connectionString);
  const client = new Client({
    connectionString: adminConnectionString,
    ssl: ssl ? { rejectUnauthorized: false } : false
  });

  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!exists.rowCount) {
      await client.query(`CREATE DATABASE ${escapeIdentifier(dbName)}`);
    }
  } finally {
    await client.end();
  }
}

module.exports = {
  ensureDatabaseExists
};
