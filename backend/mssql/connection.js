const { config, getSqlPool } = require("../sqlConnection");

module.exports = {
  config,
  getSqlPool
};

module.exports.default = config;