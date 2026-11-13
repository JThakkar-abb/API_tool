const sql = require("mssql");
const { getSqlPool } = require("./connection");

class Queries {
  async getRequest() {
    const pool = await getSqlPool();
    return pool.request();
  }

  async runQuery(query, params = {}) {
    const request = await this.getRequest();

    Object.entries(params).forEach(([name, value]) => {
      if (value === undefined || value === null) {
        return;
      }

      if (typeof value === "number") {
        request.input(name, sql.Int, value);
        return;
      }

      if (typeof value === "boolean") {
        request.input(name, sql.Bit, value);
        return;
      }

      request.input(name, sql.NVarChar, String(value));
    });

    const result = await request.query(query);
    return result.recordset;
  }

  async fetchAreas(location) {
    const candidates = [];

    if (typeof location === "number") {
      candidates.push({
        sql: "SELECT * FROM tblAreas WHERE SLoc = @location ORDER BY strName",
        params: { location }
      });
      candidates.push({
        sql: "SELECT * FROM INV.Areas WHERE InventoryLocation = @location ORDER BY AreaPK",
        params: { location }
      });
    } else {
      candidates.push({
        sql: "SELECT * FROM tblAreas ORDER BY strName",
        params: {}
      });
      candidates.push({
        sql: "SELECT * FROM INV.Areas ORDER BY AreaPK",
        params: {}
      });
    }

    let lastError;

    for (const candidate of candidates) {
      try {
        return await this.runQuery(candidate.sql, candidate.params);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Unable to fetch areas");
  }

  async fetchParts(area) {
    if (area) {
      return this.runQuery(
        `SELECT a.*
         FROM INV.PartUniverse a
         WHERE a.Area = @area OR a.Location = @area
         ORDER BY a.Material`,
        { area }
      );
    }

    return this.runQuery("SELECT * FROM INV.PartUniverse ORDER BY Material");
  }

  async fetchPipCards(pipId) {
    if (pipId) {
      return this.runQuery(
        "SELECT * FROM INV.PipCards WHERE PipId = @pipId ORDER BY PipId",
        { pipId }
      );
    }

    return this.runQuery("SELECT * FROM INV.Pip ORDER BY ID");
  }

  async fetchOrder(orderNum) {
    return this.runQuery(
      "SELECT * FROM INV.Raw_Catalog WHERE OrderNum = @orderNum ORDER BY ID",
      { orderNum }
    );
  }

  async fetchUsers() {
    return this.runQuery("SELECT * FROM INV.Users ORDER BY FullName");
  }

  async fetchTable(schema = "INV", table, options = {}) {
    const safeSchema = String(schema || "INV").replace(/[^a-zA-Z0-9_]/g, "");
    const safeTable = String(table || "").replace(/[^a-zA-Z0-9_]/g, "");
    const top = Number(options.top || 100);
    const validTop = Number.isFinite(top) ? Math.min(Math.max(top, 1), 1000) : 100;
    const orderBy = options.orderBy && String(options.orderBy).trim() ? ` ORDER BY ${String(options.orderBy).trim()}` : "";

    return this.runQuery(
      `SELECT TOP (${validTop}) * FROM ${safeSchema}.${safeTable}${orderBy}`
    );
  }

  async executeReadOnly(query, params = {}) {
    const safeSql = String(query || "").trim();

    if (!safeSql || !/^(SELECT|WITH)\b/i.test(safeSql)) {
      throw new Error("Only SELECT queries are allowed through the read-only API.");
    }

    return this.runQuery(safeSql, params);
  }
}

module.exports = new Queries();
