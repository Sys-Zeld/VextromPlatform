const { Pool } = require("pg");
const env = require("../config/env");

const pool = new Pool({
  connectionString: env.databases.specflow.url,
  ssl: env.databases.specflow.ssl ? { rejectUnauthorized: false } : false
});

module.exports = pool;
