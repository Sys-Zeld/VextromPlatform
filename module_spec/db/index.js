const { Pool } = require("pg");
const env = require("../../specflow/config/env");

const pool = new Pool({
  connectionString: env.databases.moduleSpec.url,
  ssl: env.databases.moduleSpec.ssl ? { rejectUnauthorized: false } : false
});

module.exports = pool;

