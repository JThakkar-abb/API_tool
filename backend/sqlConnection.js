
const path = require("node:path");
const sql = require("mssql");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const config = {
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,

  options: {
    encrypt: true,
    trustServerCertificate: true
  },

  connectionTimeout: 15000,
  requestTimeout: 15000,

  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let poolPromise = null;

function getSqlPool() {
  const missing = [
    "SQL_SERVER",
    "SQL_DATABASE",
    "SQL_USER",
    "SQL_PASSWORD"
  ].filter(key => !process.env[key]);

  if (missing.length) {
    throw new Error(
      `Missing SQL configuration: ${missing.join(", ")}`
    );
  }

  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch(error => {
        poolPromise = null;
        throw error;
      });
  }

  return poolPromise;
}

module.exports = { config, getSqlPool };
module.exports.default = config;
