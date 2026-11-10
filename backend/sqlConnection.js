
const path = require("node:path");
const sql = require("mssql");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const config = {
  server: process.env.SQL_SERVER || "10.90.104.27",
  database: process.env.SQL_DATABASE || "Engineering",
  user: process.env.SQL_USER || "MES_USER",
  password: process.env.SQL_PASSWORD || "Office26",

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
