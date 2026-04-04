const { Pool } = require("pg");
const env = require("../../specflow/config/env");

const pool = new Pool({
  connectionString: env.databases.config.url,
  ssl: env.databases.config.ssl ? { rejectUnauthorized: false } : false
});

module.exports = pool;
