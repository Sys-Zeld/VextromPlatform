const { Pool } = require("pg");
const env = require("../../specflow/config/env");

const pool = new Pool({
  connectionString: env.databases.reportService.url,
  ssl: env.databases.reportService.ssl ? { rejectUnauthorized: false } : false
});

module.exports = pool;

